import { addDoc, collection, db, doc, onSnapshot, serverTimestamp } from "./firebase.js?v=20260803-stock-3";

(() => {
  const products = [];
  let categories = [];
  let deliveryCost = 5000;
  const PROFILE_KEY = "horizon3d-profile";
  const MATERIAL_TYPES = ["PLA", "PLA+", "PETG", "ABS", "ASA"];
  const state = {
    category: "all",
    material: "all",
    query: "",
    sort: "featured",
    view: "products",
    visibleLimit: 8,
    cart: JSON.parse(localStorage.getItem("printlab-cart") || "{}"),
    wishlist: JSON.parse(localStorage.getItem("printlab-wishlist") || "[]"),
    selectedVariants: JSON.parse(localStorage.getItem("printlab-selected-variants") || "{}")
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const money = (value) => `${new Intl.NumberFormat("en-US").format(value)} د.ع`;

  function normalizeMaterialType(value) {
    const normalized = String(value || "").trim().toUpperCase().replace(/\s*\+\s*/g, "+");
    return MATERIAL_TYPES.includes(normalized) ? normalized : "";
  }

  function productPricing(product) {
    const price = Math.max(0, Number(product?.price) || 0);
    const legacyOldPrice = Number(product?.oldPrice) || 0;
    if (legacyOldPrice > price) {
      return { base: price, discount: legacyOldPrice - price, sale: price, compareAt: legacyOldPrice };
    }
    const legacyDiscount = Number(product?.discount) || 0;
    const discount = legacyDiscount > 0 && legacyDiscount < price ? legacyDiscount : 0;
    return { base: price, discount, sale: Math.max(0, price - discount), compareAt: discount ? price : 0 };
  }

  function discountedPrice(product) {
    return productPricing(product).sale;
  }

  function productVariants(product) {
    return (Array.isArray(product?.variants) ? product.variants : [])
      .map((variant, index) => ({
        id: String(variant?.id || `variant-${index + 1}`),
        name: String(variant?.name || "").trim(),
        color: /^#[0-9a-f]{6}$/i.test(String(variant?.color || "")) ? String(variant.color) : "#111111",
        image: String(variant?.image || ""),
        stock: Math.max(0, Math.floor(Number(variant?.stock) || 0)),
      }))
      .filter((variant) => variant.name && variant.image);
  }

  function selectedVariant(product, requestedId = "") {
    if (!product) return null;
    const variants = productVariants(product);
    if (!variants.length) return null;
    const selectedId = requestedId || state.selectedVariants[product.id];
    return variants.find((variant) => variant.id === selectedId)
      || variants.find((variant) => variant.stock > 0)
      || variants[0];
  }

  function productStock(product, variantId = "") {
    const variant = selectedVariant(product, variantId);
    if (variant) return variant.stock;
    const stock = Number(product?.stock);
    return Number.isFinite(stock) && stock >= 0 ? Math.floor(stock) : 0;
  }

  function cartKey(productId, variantId = "") {
    return variantId ? `${productId}::${variantId}` : String(productId);
  }

  function parseCartKey(key) {
    const [productId, variantId = ""] = String(key).split("::");
    return { productId: Number(productId), variantId };
  }

  function cartQuantityForProduct(productId) {
    return Object.entries(state.cart).reduce((sum, [key, quantity]) => {
      return sum + (parseCartKey(key).productId === Number(productId) ? Number(quantity) || 0 : 0);
    }, 0);
  }

  function productAddedAt(product) {
    const createdAt = product?.createdAt ?? product?.createdAtClient;
    if (typeof createdAt?.toMillis === "function") return createdAt.toMillis();
    if (Number.isFinite(Number(createdAt?.seconds))) {
      return (Number(createdAt.seconds) * 1000) + Math.floor((Number(createdAt.nanoseconds) || 0) / 1000000);
    }
    const parsedDate = Date.parse(createdAt);
    if (Number.isFinite(parsedDate)) return parsedDate;
    const numericId = Number(product?.id);
    return Number.isFinite(numericId) ? numericId : 0;
  }

  function productArtwork(product, variant = selectedVariant(product)) {
    const image = variant?.image || product.image;
    if (image) {
      return `<div class="product-art remote-image" style="--accent:${variant?.color || product.color || "#f6aa1c"}"><img src="${image}" alt="${escapeHtml(product.name)}${variant ? ` — ${escapeHtml(variant.name)}` : ""}"><small>HORIZON 3D SELECT</small></div>`;
    }
    const art = {
      printer: `<div class="mini-printer"><i></i><b></b><span></span></div>`,
      "resin-printer": `<div class="mini-resin"><i></i><b></b><span></span></div>`,
      spool: `<div class="mini-spool"><i></i><b></b><span></span></div>`,
      bottle: `<div class="mini-bottle"><i></i><b>RESIN</b><span></span></div>`,
      hotend: `<div class="mini-hotend"><i></i><b></b><span></span></div>`,
      tools: `<div class="mini-tools"><i></i><b></b><span></span></div>`
    };
    return `<div class="product-art" style="--accent:${product.color}"><div class="art-grid"></div>${art[product.icon] || art.spool}<small>HORIZON 3D SELECT</small></div>`;
  }

  function getVisibleProducts() {
    let list = products.filter((p) => {
      const categoryMatch = state.category === "all" || p.category === state.category;
      const materialMatch = state.material === "all" || p.materialType === state.material;
      const wishlistMatch = state.view !== "wishlist" || state.wishlist.includes(p.id);
      const term = state.query.trim().toLowerCase();
      const searchMatch = !term || `${p.name} ${p.categoryLabel} ${p.materialType || ""}`.toLowerCase().includes(term);
      return categoryMatch && materialMatch && wishlistMatch && searchMatch;
    });
    if (state.sort === "featured") list.sort((a,b) => productAddedAt(b) - productAddedAt(a));
    if (state.sort === "price-asc") list.sort((a,b) => discountedPrice(a) - discountedPrice(b));
    if (state.sort === "price-desc") list.sort((a,b) => discountedPrice(b) - discountedPrice(a));
    if (state.sort === "rating") list.sort((a,b) => b.rating - a.rating);
    return list;
  }

  function variantSwatchesHtml(product, selected = selectedVariant(product), context = "card") {
    const variants = productVariants(product);
    if (!variants.length) return "";
    return `<div class="variant-swatches ${context === "modal" ? "modal-variant-swatches" : ""}" role="group" aria-label="اختر لون ${escapeHtml(product.name)}">
      ${variants.map((variant) => `<button type="button" class="variant-swatch ${selected?.id === variant.id ? "active" : ""} ${variant.stock === 0 ? "sold-out" : ""}" style="--swatch:${variant.color}" data-select-variant="${escapeHtml(variant.id)}" data-variant-product="${product.id}" title="${escapeHtml(variant.name)}${variant.stock === 0 ? " — نافذ" : ""}" aria-label="${escapeHtml(variant.name)}" aria-pressed="${selected?.id === variant.id}"><i></i></button>`).join("")}
      <span class="selected-variant-name">${escapeHtml(selected?.name || "")}</span>
    </div>`;
  }

  function renderProducts() {
    const allMatches = getVisibleProducts();
    const list = allMatches.slice(0, state.visibleLimit);
    $("#productGrid").innerHTML = list.map((p) => {
      const variant = selectedVariant(p);
      const stock = productStock(p, variant?.id);
      const cartQuantity = cartQuantityForProduct(p.id);
      return `
      <article class="product-card ${stock === 0 ? "out-of-stock" : ""} ${cartQuantity > 0 ? "in-cart" : ""}" data-product-card="${p.id}">
        ${cartQuantity > 0 ? `<span class="cart-selected-badge">✓ في السلة (${cartQuantity})</span>` : ""}
        <div class="product-image">
          ${p.badge ? `<span class="product-badge">${p.badge}</span>` : ""}
          <button class="wish ${state.wishlist.includes(p.id) ? "active" : ""}" data-wish="${p.id}" aria-label="إضافة للمفضلة">${state.wishlist.includes(p.id) ? "♥" : "♡"}</button>
          <button class="quick" data-quick="${p.id}">معاينة سريعة</button>
          ${productArtwork(p, variant)}
          ${variantSwatchesHtml(p, variant)}
        </div>
        <div class="product-info">
          <small>${p.categoryLabel}${p.materialType ? ` · ${p.materialType}` : ""}</small>
          <h3>${p.name}</h3>
          <div class="rating"><span>★★★★★</span> <small>${p.rating} (${p.reviews})</small></div>
          <div class="product-meta-row">
            <div class="price"><b>${money(discountedPrice(p))}</b>${productPricing(p).compareAt ? `<del>${money(productPricing(p).compareAt)}</del>` : ""}</div>
            <span class="stock-badge ${stock === 0 ? "empty" : ""}">${stock === 0 ? "نافذ" : `متوفر: ${stock}`}</span>
          </div>
          <button class="add-cart" data-add="${p.id}" ${stock === 0 ? "disabled" : ""}><span>${stock === 0 ? "نافذ" : "أضف للسلة"}</span><b>${stock === 0 ? "×" : "＋"}</b></button>
        </div>
      </article>`;
    }).join("");
    $("#emptyState").hidden = list.length > 0;
    $("#productGrid").hidden = list.length === 0;
    if (!list.length && state.view === "wishlist") $("#emptyState").innerHTML = `<span>♡</span><h3>المفضلات فارغة</h3><p>اضغط على القلب في أي منتج لإضافته هنا.</p>`;
    if (!list.length && state.view !== "wishlist") $("#emptyState").innerHTML = products.length
      ? `<span>⌕</span><h3>ما لقينا نتائج</h3><p>جرّب كلمة أو فئة ثانية.</p>`
      : `<span>◇</span><h3>لا توجد منتجات بعد</h3><p>ستظهر المنتجات هنا فور إضافتها من لوحة الأدمن.</p>`;
    const remaining = Math.max(0, allMatches.length - list.length);
    $("#loadMoreWrap").hidden = remaining === 0;
    $("#remainingCount").textContent = remaining ? `${remaining} منتجات متبقية` : "";
    const filter = $("#activeFilter");
    if (state.query || state.material !== "all") {
      filter.hidden = false;
      const queryLabel = state.query ? `البحث: <b>${escapeHtml(state.query)}</b>` : "";
      const materialLabel = state.material !== "all" ? `المادة: <b>${escapeHtml(state.material)}</b>` : "";
      filter.innerHTML = `${[queryLabel, materialLabel].filter(Boolean).join(" — ")} <button id="clearSearch">× مسح الفلتر</button>`;
      $("#clearSearch").onclick = () => {
        state.query = "";
        state.material = "all";
        state.visibleLimit = 8;
        $("#searchInput").value = "";
        $("#materialFilter").value = "all";
        renderProducts();
      };
    } else filter.hidden = true;
    bindProductButtons();
  }

  function escapeHtml(text) {
    const node = document.createElement("div");
    node.textContent = text;
    return node.innerHTML;
  }

  function bindProductButtons() {
    $$('[data-add]').forEach((button) => button.onclick = () => addToCart(Number(button.dataset.add)));
    $$('[data-wish]').forEach((button) => button.onclick = () => toggleWish(Number(button.dataset.wish)));
    $$('[data-quick]').forEach((button) => button.onclick = () => openProduct(Number(button.dataset.quick)));
    $$('[data-select-variant]').forEach((button) => button.onclick = (event) => {
      event.stopPropagation();
      const product = products.find((item) => item.id === Number(button.dataset.variantProduct));
      const variant = selectedVariant(product, button.dataset.selectVariant);
      if (!product || !variant) return;
      state.selectedVariants[product.id] = variant.id;
      saveState();
      renderProducts();
    });
    $$('[data-product-card]').forEach((card) => card.onclick = (event) => {
      if (event.target.closest("button, a")) return;
      openProduct(Number(card.dataset.productCard));
    });
  }

  function saveState() {
    localStorage.setItem("printlab-cart", JSON.stringify(state.cart));
    localStorage.setItem("printlab-wishlist", JSON.stringify(state.wishlist));
    localStorage.setItem("printlab-selected-variants", JSON.stringify(state.selectedVariants));
  }

  function addToCart(id, requestedVariantId = "") {
    const product = products.find((item) => item.id === Number(id));
    const variant = selectedVariant(product, requestedVariantId);
    const stock = productStock(product, variant?.id);
    if (!product || stock === 0) {
      showToast("هذا المنتج نافذ حاليًا");
      return;
    }
    const key = cartKey(id, variant?.id);
    if ((state.cart[key] || 0) >= stock) {
      showToast(`الكمية المتوفرة من ${variant ? `لون ${variant.name}` : "هذا المنتج"} هي ${stock} فقط`);
      return;
    }
    state.cart[key] = (state.cart[key] || 0) + 1;
    saveState(); updateCart(); renderProducts(); showToast(variant ? `تمت إضافة لون ${variant.name} إلى السلة` : "تمت إضافة المنتج إلى السلة");
  }

  function toggleWish(id) {
    state.wishlist = state.wishlist.includes(id) ? state.wishlist.filter((item) => item !== id) : [...state.wishlist, id];
    saveState(); renderProducts(); updateCounts();
    showToast(state.wishlist.includes(id) ? "أُضيف إلى المفضلة" : "أُزيل من المفضلة");
  }

  function updateCounts() {
    const cartItemsCount = Object.values(state.cart).reduce((a,b) => a + b, 0);
    $("#cartCount").textContent = cartItemsCount;
    $("#bottomCartCount").textContent = cartItemsCount;
    $("#wishCount").textContent = state.wishlist.length;
    $("#bottomWishCount").textContent = state.wishlist.length;
  }

  function updateCart() {
    let cartChanged = false;
    Object.keys(state.cart).forEach((key) => {
      const { productId, variantId } = parseCartKey(key);
      const product = products.find((item) => item.id === productId);
      const variants = productVariants(product);
      if (product && !variantId && variants.length) {
        const variant = selectedVariant(product);
        const migratedKey = cartKey(productId, variant?.id);
        state.cart[migratedKey] = Math.min(variant?.stock || 0, (state.cart[migratedKey] || 0) + (Number(state.cart[key]) || 0));
        delete state.cart[key];
        cartChanged = true;
        return;
      }
      const variant = variantId ? variants.find((item) => item.id === variantId) : null;
      const available = product ? productStock(product, variant?.id) : 0;
      if (!product || (variantId && !variant) || available === 0) {
        delete state.cart[key];
        cartChanged = true;
      } else if (state.cart[key] > available) {
        state.cart[key] = available;
        cartChanged = true;
      }
    });
    if (cartChanged) saveState();
    const entries = Object.entries(state.cart).map(([key, quantity]) => {
      const parsed = parseCartKey(key);
      const product = products.find((item) => item.id === parsed.productId);
      const variant = parsed.variantId ? productVariants(product).find((item) => item.id === parsed.variantId) : null;
      return { key, quantity: Number(quantity) || 0, product, variant };
    }).filter((entry) => entry.quantity > 0 && entry.product);
    $("#cartItems").innerHTML = entries.map(({ key, quantity, product: p, variant }) => {
      return `<article class="cart-row">
        <div class="cart-thumb">${productArtwork(p, variant)}</div>
        <div><h4>${p.name}</h4>${variant ? `<span class="cart-variant"><i style="--swatch:${variant.color}"></i>${escapeHtml(variant.name)}</span>` : ""}<b>${money(discountedPrice(p))}</b><div class="qty"><button data-minus="${escapeHtml(key)}">−</button><span>${quantity}</span><button data-plus="${escapeHtml(key)}" ${quantity >= productStock(p, variant?.id) ? "disabled" : ""}>＋</button></div></div>
        <button class="remove" data-remove="${escapeHtml(key)}" aria-label="حذف">×</button>
      </article>`;
    }).join("");
    const subtotal = entries.reduce((sum, entry) => sum + discountedPrice(entry.product) * entry.quantity, 0);
    const total = entries.length ? subtotal + deliveryCost : 0;
    $("#cartSubtotal").textContent = money(subtotal);
    $("#shippingCost").textContent = money(deliveryCost);
    $("#cartTotal").textContent = money(total);
    $("#cartEmpty").hidden = entries.length > 0;
    $("#cartFooter").hidden = entries.length === 0;
    $$('[data-plus]').forEach((b) => b.onclick = () => { const parsed = parseCartKey(b.dataset.plus); addToCart(parsed.productId, parsed.variantId); });
    $$('[data-minus]').forEach((b) => b.onclick = () => { state.cart[b.dataset.minus]--; if (state.cart[b.dataset.minus] <= 0) delete state.cart[b.dataset.minus]; saveState(); updateCart(); renderProducts(); });
    $$('[data-remove]').forEach((b) => b.onclick = () => { delete state.cart[b.dataset.remove]; saveState(); updateCart(); renderProducts(); });
    updateCounts();
  }

  function openCart() {
    $("#cartDrawer").classList.add("open"); $("#overlay").classList.add("show");
    $("#cartDrawer").setAttribute("aria-hidden", "false"); document.body.classList.add("locked");
  }
  function closeCart() {
    $("#cartDrawer").classList.remove("open"); $("#overlay").classList.remove("show");
    $("#cartDrawer").setAttribute("aria-hidden", "true"); document.body.classList.remove("locked");
  }

  function openProduct(id) {
    const p = products.find((item) => item.id === id);
    if (!p) return;
    const variant = selectedVariant(p);
    const pricing = productPricing(p);
    const stock = productStock(p, variant?.id);
    $("#modalContent").innerHTML = `<div class="modal-grid"><div><div class="modal-product-art">${productArtwork(p, variant)}${variantSwatchesHtml(p, variant, "modal")}</div></div><div><small>${p.categoryLabel}</small><h2>${p.name}</h2><div class="rating"><span>★★★★★</span> ${p.rating} (${p.reviews} تقييماً)</div><p>${p.description || "منتج مختار بعناية بجودة موثوقة وضمان من Horizon 3D Store."}</p><div class="price big"><b>${money(pricing.sale)}</b>${pricing.compareAt ? `<del>${money(pricing.compareAt)}</del>` : ""}</div><p class="stock">● متوفر الآن — ${stock} قطع</p><div class="modal-actions"><button class="btn primary" id="modalAdd">أضف للسلة</button><button class="btn modal-back" id="modalBack">رجوع للمنتجات</button></div></div></div>`;
    const stockLabel = $("#modalContent .stock");
    stockLabel.textContent = stock === 0 ? "نافذ حاليًا" : `متوفر الآن — ${stock} قطعة`;
    stockLabel.classList.toggle("out", stock === 0);
    const modalAddButton = $("#modalAdd");
    modalAddButton.disabled = stock === 0;
    modalAddButton.textContent = stock === 0 ? "المنتج نافذ" : "أضف للسلة";
    if (!$("#productModal").open) $("#productModal").showModal();
    modalAddButton.onclick = () => { addToCart(id, variant?.id); $("#productModal").close(); };
    $$('#modalContent [data-select-variant]').forEach((button) => button.onclick = () => {
      state.selectedVariants[id] = button.dataset.selectVariant;
      saveState();
      renderProducts();
      openProduct(id);
    });
    $("#modalBack").onclick = () => $("#productModal").close();
  }

  let toastTimer;
  function showToast(message) {
    clearTimeout(toastTimer); const toast = $("#toast"); toast.textContent = `✓ ${message}`; toast.classList.add("show");
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    $("#themeToggle").textContent = theme === "dark" ? "☀" : "☾";
    localStorage.setItem("printlab-theme", theme);
    refreshThemeChoices(theme);
  }

  function updateLiveSearch(shouldScroll = false) {
    state.view = "products";
    state.category = "all";
    state.query = $("#searchInput").value;
    state.visibleLimit = 8;
    $$('.category-card').forEach((button) => button.classList.toggle("active", button.dataset.category === "all"));
    renderProducts();
    if (shouldScroll) $("#products").scrollIntoView({ behavior: "smooth" });
  }

  $("#searchInput").addEventListener("input", () => updateLiveSearch(false));
  $("#searchForm").onsubmit = (event) => {
    event.preventDefault();
    updateLiveSearch(true);
  };
  $("#sortSelect").onchange = (e) => { state.sort = e.target.value; state.visibleLimit = 8; renderProducts(); };
  $("#materialFilter").onchange = (event) => {
    state.material = event.target.value;
    state.visibleLimit = 8;
    state.view = "products";
    renderProducts();
  };

  function renderMaterialFilter() {
    const available = new Set(products.map((product) => normalizeMaterialType(product.materialType)).filter(Boolean));
    const options = MATERIAL_TYPES.filter((type) => available.has(type));
    const select = $("#materialFilter");
    if (state.material !== "all" && !available.has(state.material)) state.material = "all";
    select.innerHTML = '<option value="all">كل المواد</option>' + options.map((type) => `<option value="${type}">${type}</option>`).join("");
    select.value = state.material;
    select.hidden = options.length === 0;
  }
  function bindCategoryFilters() {
    $$('.category-card').forEach((button) => button.onclick = () => { state.view = "products"; state.category = button.dataset.category; state.visibleLimit = 8; $$('.category-card').forEach((b) => b.classList.toggle("active", b === button)); renderProducts(); $("#products").scrollIntoView({behavior:"smooth"}); });
    $$('[data-filter-link]').forEach((link) => link.onclick = () => { state.view = "products"; state.category = link.dataset.filterLink; state.visibleLimit = 8; renderProducts(); });
  }

  function renderCategories() {
    if (state.category !== "all" && !categories.some((category) => category.docId === state.category)) state.category = "all";
    $("#categoryGrid").innerHTML = `
      <button class="category-card ${state.category === "all" ? "active" : ""}" data-category="all"><span class="category-icon icon-all">✦</span><b>الكل</b><small>كل المنتجات</small></button>
      ${categories.map((category) => `<button class="category-card ${state.category === category.docId ? "active" : ""}" data-category="${category.docId}"><span class="category-icon dynamic-category-icon">${category.image ? `<img src="${category.image}" alt="">` : "◇"}</span><b>${escapeHtml(category.name)}</b><small>عرض المنتجات</small></button>`).join("")}`;
    $("#navCategoryLinks").innerHTML = categories.map((category) => `<a href="#products" data-filter-link="${category.docId}">${escapeHtml(category.name)}</a>`).join("");
    bindCategoryFilters();
  }
  $("#loadMoreBtn").onclick = () => { state.visibleLimit += 8; renderProducts(); };
  $("#cartBtn").onclick = openCart; $("#closeCart").onclick = closeCart; $("#overlay").onclick = closeCart;
  $("#bottomCart").onclick = openCart;
  function showWishlist() {
    state.view = "wishlist"; state.category = "all"; state.query = ""; state.visibleLimit = 8;
    $("#searchInput").value = ""; renderProducts(); $("#products").scrollIntoView({behavior:"smooth"});
  }
  $("#bottomFavorites").onclick = showWishlist;
  $("#bottomCategories").onclick = () => {
    state.view = "products"; state.category = "all"; state.visibleLimit = 8;
    $("#categories").scrollIntoView({behavior:"smooth"});
  };
  const profileModal = $("#profileModal");
  const profileForm = $("#profileForm");
  const profileFields = {
    name: $("#profileName"), phone: $("#profilePhone"), address: $("#profileAddress"),
    landmark: $("#profileLandmark"), governorate: $("#profileGovernorate")
  };
  function readProfile() {
    try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}"); } catch { return {}; }
  }
  function fillProfileForm() {
    const profile = readProfile();
    Object.keys(profileFields).forEach((key) => profileFields[key].value = profile[key] || "");
    $$('.profile-form .field-error').forEach((item) => item.textContent = "");
    $$('.profile-form .form-field').forEach((item) => item.classList.remove("invalid"));
  }
  function refreshThemeChoices(theme) {
    $$('[data-theme-choice]').forEach((button) => button.classList.toggle("active", button.dataset.themeChoice === theme));
  }
  $("#bottomProfile").onclick = () => { fillProfileForm(); refreshThemeChoices(document.documentElement.dataset.theme); profileModal.showModal(); };
  $("#profileClose").onclick = () => profileModal.close();
  profileFields.phone.oninput = () => { profileFields.phone.value = profileFields.phone.value.replace(/\D/g, "").slice(0, 11); };
  profileForm.onsubmit = (e) => {
    e.preventDefault();
    $$('.profile-form .field-error').forEach((item) => item.textContent = "");
    $$('.profile-form .form-field').forEach((item) => item.classList.remove("invalid"));
    let valid = true;
    if (profileFields.name.value.trim().length < 2) { fieldError(profileFields.name,"#profileNameError","اكتب الاسم الكامل"); valid = false; }
    if (!/^\d{11}$/.test(profileFields.phone.value)) { fieldError(profileFields.phone,"#profilePhoneError","رقم الهاتف يجب أن يكون 11 رقماً"); valid = false; }
    if (profileFields.address.value.trim().length < 5) { fieldError(profileFields.address,"#profileAddressError","اكتب العنوان بالتفصيل"); valid = false; }
    if (!profileFields.governorate.value) { fieldError(profileFields.governorate,"#profileGovernorateError","اختر المحافظة"); valid = false; }
    if (!valid) return;
    const profile = Object.fromEntries(Object.entries(profileFields).map(([key,field]) => [key,field.value.trim()]));
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    showToast("تم حفظ معلومات البروفايل"); profileModal.close();
  };
  $("#clearProfile").onclick = () => {
    localStorage.removeItem(PROFILE_KEY); fillProfileForm(); showToast("تم مسح معلومات البروفايل");
  };
  $("#themeToggle").onclick = () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  $$('[data-theme-choice]').forEach((button) => button.onclick = () => setTheme(button.dataset.themeChoice));
  $("#mobileToggle").onclick = () => $("#mainNav").classList.toggle("open");
  $("#modalClose").onclick = () => $("#productModal").close();
  $("#wishlistBtn").onclick = showWishlist;
  const checkoutModal = $("#checkoutModal");
  const successDialog = $("#successDialog");
  const checkoutForm = $("#checkoutForm");
  const checkoutFields = {
    name: $("#customerName"), phone: $("#customerPhone"),
    address: $("#customerAddress"), governorate: $("#customerGovernorate")
  };
  function currentOrderTotal() {
    return Object.entries(state.cart).reduce((sum, [key, quantity]) => {
      const { productId } = parseCartKey(key);
      const product = products.find((item) => item.id === productId);
      return sum + (product ? discountedPrice(product) * (Number(quantity) || 0) : 0);
    }, 0) + deliveryCost;
  }
  function clearFieldErrors() {
    $$('.field-error').forEach((item) => item.textContent = "");
    $$('.form-field').forEach((item) => item.classList.remove("invalid"));
  }
  function fieldError(field, errorId, message) {
    field.closest(".form-field").classList.add("invalid");
    $(errorId).textContent = message;
  }
  $("#checkoutBtn").onclick = () => {
    clearFieldErrors();
    const savedProfile = readProfile();
    checkoutFields.name.value = savedProfile.name || "";
    checkoutFields.phone.value = savedProfile.phone || "";
    checkoutFields.address.value = [savedProfile.address,savedProfile.landmark].filter(Boolean).join(" — ");
    checkoutFields.governorate.value = savedProfile.governorate || "";
    $("#checkoutOrderTotal").textContent = money(currentOrderTotal());
    closeCart(); checkoutModal.showModal();
  };
  $("#checkoutClose").onclick = () => checkoutModal.close();
  checkoutFields.phone.oninput = () => { checkoutFields.phone.value = checkoutFields.phone.value.replace(/\D/g, "").slice(0, 11); };
  checkoutForm.onsubmit = async (e) => {
    e.preventDefault(); clearFieldErrors();
    let valid = true;
    if (checkoutFields.name.value.trim().length < 2) { fieldError(checkoutFields.name,"#nameError","اكتب الاسم الكامل"); valid = false; }
    if (!/^\d{11}$/.test(checkoutFields.phone.value)) { fieldError(checkoutFields.phone,"#phoneError","رقم الهاتف يجب أن يكون 11 رقماً"); valid = false; }
    if (checkoutFields.address.value.trim().length < 5) { fieldError(checkoutFields.address,"#addressError","اكتب العنوان بالتفصيل"); valid = false; }
    if (!checkoutFields.governorate.value) { fieldError(checkoutFields.governorate,"#governorateError","اختر المحافظة"); valid = false; }
    if (!valid) return;
    const stockIssue = Object.entries(state.cart).map(([key, quantity]) => {
      const { productId, variantId } = parseCartKey(key);
      const product = products.find((item) => item.id === productId);
      const variant = variantId ? productVariants(product).find((item) => item.id === variantId) : null;
      return {
      product,
      variant,
      variantId,
      quantity: Number(quantity) || 0,
    }; }).find((item) => !item.product || (item.variantId && !item.variant) || item.quantity > productStock(item.product, item.variant?.id));
    if (stockIssue) {
      updateCart();
      showToast(stockIssue.product ? `الكمية المتوفرة من ${stockIssue.variant ? `لون «${stockIssue.variant.name}»` : `«${stockIssue.product.name}»`} هي ${productStock(stockIssue.product, stockIssue.variant?.id)} فقط` : "أحد المنتجات لم يعد متوفرًا");
      return;
    }
    const submit = checkoutForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const orderRef = `HZ-${Date.now().toString().slice(-7)}`;
      const items = Object.entries(state.cart).map(([key, quantity]) => {
        const { productId, variantId } = parseCartKey(key);
        const product = products.find((item) => item.id === productId);
        const variant = variantId ? productVariants(product).find((item) => item.id === variantId) : null;
        const price = discountedPrice(product);
        return {
          id: productId,
          productDocId: product.docId || "",
          name: product.name,
          image: variant?.image || product.image || "",
          categoryLabel: product.categoryLabel || "",
          variantId: variant?.id || "",
          variantName: variant?.name || "",
          variantColor: variant?.color || "",
          price,
          quantity,
          lineTotal: price * quantity,
        };
      });
      const customer = Object.fromEntries(Object.entries(checkoutFields).map(([key, field]) => [key, field.value.trim()]));
      const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
      await addDoc(collection(db, "orders"), {
        reference: orderRef,
        customer,
        items,
        itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
        subtotal,
        deliveryCost,
        total: subtotal + deliveryCost,
        status: "pending",
        createdAt: serverTimestamp(),
        createdAtClient: new Date().toISOString(),
      });
      $("#orderReference").textContent = orderRef;
      $("#whatsappAdmin").href = `https://wa.me/9647721425703?text=${encodeURIComponent(`السلام عليكم، أود تذكيركم بمراجعة طلبي رقم ${orderRef}`)}`;
      state.cart = {}; saveState(); updateCart(); checkoutForm.reset();
      checkoutModal.close(); successDialog.showModal();
    } catch (error) {
      console.error("Firebase order:", error);
      showToast("تعذر إرسال الطلب إلى قاعدة البيانات. حاول مرة أخرى");
    } finally {
      submit.disabled = false;
    }
  };
  $("#successClose").onclick = () => successDialog.close();
  $("#successLater").onclick = () => successDialog.close();
  $("#backTop").onclick = () => scrollTo({top:0,behavior:"smooth"});
  window.addEventListener("scroll", () => $("#backTop").classList.toggle("show", scrollY > 650));
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCart(); });

  onSnapshot(collection(db, "products"), (snapshot) => {
    const remoteProducts = snapshot.docs
      .map((item) => ({ docId: item.id, ...item.data() }))
      .filter((product) => product.active !== false && Number.isFinite(Number(product.id)))
      .map((product) => ({
        ...product,
        id: Number(product.id),
        price: Number(product.price) || 0,
        discount: Number(product.discount) || 0,
        materialType: normalizeMaterialType(product.materialType),
        stock: productStock(product),
      }));
    products.splice(0, products.length, ...remoteProducts);
    renderMaterialFilter();
    Object.keys(state.cart).forEach((key) => {
      if (!products.some((product) => product.id === parseCartKey(key).productId)) delete state.cart[key];
    });
    state.wishlist = state.wishlist.filter((id) => products.some((product) => product.id === id));
    saveState();
    renderProducts();
    updateCart();
  }, (error) => {
    console.error("Firebase products:", error);
    showToast("تعذر تحديث المنتجات، يتم عرض النسخة المحلية");
  });

  onSnapshot(collection(db, "categories"), (snapshot) => {
    categories = snapshot.docs.map((item) => ({ docId: item.id, ...item.data() }));
    renderCategories();
    renderProducts();
  }, (error) => {
    console.error("Firebase categories:", error);
    showToast("تعذر تحديث أقسام المتجر");
  });

  onSnapshot(doc(db, "settings", "store"), (snapshot) => {
    const savedCost = Number(snapshot.data()?.deliveryCost);
    deliveryCost = Number.isFinite(savedCost) && savedCost >= 0 ? savedCost : 5000;
    $("#shippingCost").textContent = money(deliveryCost);
    const cartProductsReady = Object.keys(state.cart).every((key) => products.some((product) => product.id === parseCartKey(key).productId));
    if (cartProductsReady) updateCart();
    if (checkoutModal.open && cartProductsReady) $("#checkoutOrderTotal").textContent = money(currentOrderTotal());
  }, (error) => {
    console.error("Firebase delivery settings:", error);
    showToast("تعذر تحديث كلفة التوصيل");
  });

  setTheme(localStorage.getItem("printlab-theme") || "light");
  renderCategories(); renderProducts(); updateCounts();
})();
