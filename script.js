import { addDoc, collection, db, doc, onSnapshot, serverTimestamp } from "./firebase.js?v=20260803-stock-3";

(() => {
  const products = [];
  let categories = [];
  let deliveryCost = 5000;
  const PROFILE_KEY = "horizon3d-profile";
  const state = {
    category: "all",
    query: "",
    sort: "featured",
    view: "products",
    visibleLimit: 8,
    cart: JSON.parse(localStorage.getItem("printlab-cart") || "{}"),
    wishlist: JSON.parse(localStorage.getItem("printlab-wishlist") || "[]")
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const money = (value) => `${new Intl.NumberFormat("en-US").format(value)} د.ع`;

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

  function productStock(product) {
    const stock = Number(product?.stock);
    return Number.isFinite(stock) && stock >= 0 ? Math.floor(stock) : 0;
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

  function productArtwork(product) {
    if (product.image) {
      return `<div class="product-art remote-image" style="--accent:${product.color || "#f6aa1c"}"><img src="${product.image}" alt="${escapeHtml(product.name)}"><small>HORIZON 3D SELECT</small></div>`;
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
      const wishlistMatch = state.view !== "wishlist" || state.wishlist.includes(p.id);
      const term = state.query.trim().toLowerCase();
      const searchMatch = !term || `${p.name} ${p.categoryLabel}`.toLowerCase().includes(term);
      return categoryMatch && wishlistMatch && searchMatch;
    });
    if (state.sort === "featured") list.sort((a,b) => productAddedAt(b) - productAddedAt(a));
    if (state.sort === "price-asc") list.sort((a,b) => discountedPrice(a) - discountedPrice(b));
    if (state.sort === "price-desc") list.sort((a,b) => discountedPrice(b) - discountedPrice(a));
    if (state.sort === "rating") list.sort((a,b) => b.rating - a.rating);
    return list;
  }

  function renderProducts() {
    const allMatches = getVisibleProducts();
    const list = allMatches.slice(0, state.visibleLimit);
    $("#productGrid").innerHTML = list.map((p) => `
      <article class="product-card ${productStock(p) === 0 ? "out-of-stock" : ""} ${state.cart[p.id] > 0 ? "in-cart" : ""}" data-product-card="${p.id}">
        ${state.cart[p.id] > 0 ? `<span class="cart-selected-badge">✓ في السلة (${state.cart[p.id]})</span>` : ""}
        <div class="product-image">
          ${p.badge ? `<span class="product-badge">${p.badge}</span>` : ""}
          <button class="wish ${state.wishlist.includes(p.id) ? "active" : ""}" data-wish="${p.id}" aria-label="إضافة للمفضلة">${state.wishlist.includes(p.id) ? "♥" : "♡"}</button>
          <button class="quick" data-quick="${p.id}">معاينة سريعة</button>
          ${productArtwork(p)}
        </div>
        <div class="product-info">
          <small>${p.categoryLabel}</small>
          <h3>${p.name}</h3>
          <div class="rating"><span>★★★★★</span> <small>${p.rating} (${p.reviews})</small></div>
          <div class="product-meta-row">
            <div class="price"><b>${money(discountedPrice(p))}</b>${productPricing(p).compareAt ? `<del>${money(productPricing(p).compareAt)}</del>` : ""}</div>
            <span class="stock-badge ${productStock(p) === 0 ? "empty" : ""}">${productStock(p) === 0 ? "نافذ" : `متوفر: ${productStock(p)}`}</span>
          </div>
          <button class="add-cart" data-add="${p.id}" ${productStock(p) === 0 ? "disabled" : ""}><span>${productStock(p) === 0 ? "نافذ" : "أضف للسلة"}</span><b>${productStock(p) === 0 ? "×" : "＋"}</b></button>
        </div>
      </article>`).join("");
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
    if (state.query) {
      filter.hidden = false;
      filter.innerHTML = `نتائج البحث عن: <b>${escapeHtml(state.query)}</b> <button id="clearSearch">× مسح</button>`;
      $("#clearSearch").onclick = () => { state.query = ""; state.visibleLimit = 8; $("#searchInput").value = ""; renderProducts(); };
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
    $$('[data-product-card]').forEach((card) => card.onclick = (event) => {
      if (event.target.closest("button, a")) return;
      openProduct(Number(card.dataset.productCard));
    });
  }

  function saveState() {
    localStorage.setItem("printlab-cart", JSON.stringify(state.cart));
    localStorage.setItem("printlab-wishlist", JSON.stringify(state.wishlist));
  }

  function addToCart(id) {
    const product = products.find((item) => item.id === Number(id));
    if (!product || productStock(product) === 0) {
      showToast("هذا المنتج نافذ حاليًا");
      return;
    }
    if ((state.cart[id] || 0) >= productStock(product)) {
      showToast(`الكمية المتوفرة من هذا المنتج هي ${productStock(product)} فقط`);
      return;
    }
    state.cart[id] = (state.cart[id] || 0) + 1;
    saveState(); updateCart(); renderProducts(); showToast("تمت إضافة المنتج إلى السلة");
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
    Object.keys(state.cart).forEach((id) => {
      const product = products.find((item) => item.id === Number(id));
      const available = productStock(product);
      if (!product || available === 0) {
        delete state.cart[id];
        cartChanged = true;
      } else if (state.cart[id] > available) {
        state.cart[id] = available;
        cartChanged = true;
      }
    });
    if (cartChanged) saveState();
    const entries = Object.entries(state.cart).filter(([,qty]) => qty > 0);
    $("#cartItems").innerHTML = entries.map(([id,qty]) => {
      const p = products.find((item) => item.id === Number(id));
      return `<article class="cart-row">
        <div class="cart-thumb">${productArtwork(p)}</div>
        <div><h4>${p.name}</h4><b>${money(discountedPrice(p))}</b><div class="qty"><button data-minus="${p.id}">−</button><span>${qty}</span><button data-plus="${p.id}" ${qty >= productStock(p) ? "disabled" : ""}>＋</button></div></div>
        <button class="remove" data-remove="${p.id}" aria-label="حذف">×</button>
      </article>`;
    }).join("");
    const subtotal = entries.reduce((sum,[id,qty]) => sum + discountedPrice(products.find((p) => p.id === Number(id))) * qty, 0);
    const total = entries.length ? subtotal + deliveryCost : 0;
    $("#cartSubtotal").textContent = money(subtotal);
    $("#shippingCost").textContent = money(deliveryCost);
    $("#cartTotal").textContent = money(total);
    $("#cartEmpty").hidden = entries.length > 0;
    $("#cartFooter").hidden = entries.length === 0;
    $$('[data-plus]').forEach((b) => b.onclick = () => addToCart(Number(b.dataset.plus)));
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
    const pricing = productPricing(p);
    const stock = productStock(p);
    $("#modalContent").innerHTML = `<div class="modal-grid"><div>${productArtwork(p)}</div><div><small>${p.categoryLabel}</small><h2>${p.name}</h2><div class="rating"><span>★★★★★</span> ${p.rating} (${p.reviews} تقييماً)</div><p>${p.description || "منتج مختار بعناية بجودة موثوقة وضمان من Horizon 3D Store."}</p><div class="price big"><b>${money(pricing.sale)}</b>${pricing.compareAt ? `<del>${money(pricing.compareAt)}</del>` : ""}</div><p class="stock">● متوفر الآن — ${stock} قطع</p><div class="modal-actions"><button class="btn primary" id="modalAdd">أضف للسلة</button><button class="btn modal-back" id="modalBack">رجوع للمنتجات</button></div></div></div>`;
    const stockLabel = $("#modalContent .stock");
    stockLabel.textContent = stock === 0 ? "نافذ حاليًا" : `متوفر الآن — ${stock} قطعة`;
    stockLabel.classList.toggle("out", stock === 0);
    const modalAddButton = $("#modalAdd");
    modalAddButton.disabled = stock === 0;
    modalAddButton.textContent = stock === 0 ? "المنتج نافذ" : "أضف للسلة";
    $("#productModal").showModal();
    modalAddButton.onclick = () => { addToCart(id); $("#productModal").close(); };
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
    return Object.entries(state.cart).reduce((sum,[id,qty]) => sum + discountedPrice(products.find((p) => p.id === Number(id))) * qty, 0) + deliveryCost;
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
    const stockIssue = Object.entries(state.cart).map(([id, quantity]) => ({
      product: products.find((item) => item.id === Number(id)),
      quantity: Number(quantity) || 0,
    })).find((item) => !item.product || item.quantity > productStock(item.product));
    if (stockIssue) {
      updateCart();
      showToast(stockIssue.product ? `الكمية المتوفرة من «${stockIssue.product.name}» هي ${productStock(stockIssue.product)} فقط` : "أحد المنتجات لم يعد متوفرًا");
      return;
    }
    const submit = checkoutForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const orderRef = `HZ-${Date.now().toString().slice(-7)}`;
      const items = Object.entries(state.cart).map(([id, quantity]) => {
        const product = products.find((item) => item.id === Number(id));
        const price = discountedPrice(product);
        return {
          id: Number(id),
          productDocId: product.docId || "",
          name: product.name,
          image: product.image || "",
          categoryLabel: product.categoryLabel || "",
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
        stock: productStock(product),
      }));
    products.splice(0, products.length, ...remoteProducts);
    Object.keys(state.cart).forEach((id) => {
      if (!products.some((product) => product.id === Number(id))) delete state.cart[id];
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
    const cartProductsReady = Object.keys(state.cart).every((id) => products.some((product) => product.id === Number(id)));
    if (cartProductsReady) updateCart();
    if (checkoutModal.open && cartProductsReady) $("#checkoutOrderTotal").textContent = money(currentOrderTotal());
  }, (error) => {
    console.error("Firebase delivery settings:", error);
    showToast("تعذر تحديث كلفة التوصيل");
  });

  setTheme(localStorage.getItem("printlab-theme") || "dark");
  renderCategories(); renderProducts(); updateCounts();
})();
