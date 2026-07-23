// ===== Product catalog — loaded from the real backend (/api/perfumes) =====
// escapeHtml, genderLabel, genderBadgeClasses, and the cart helpers live in cart-utils.js
let products = [];

function splitNotes(str) {
    return (str || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}

// Shortest note in a list — used for the card's tag row so it picks a consistent,
// short word per category instead of whatever happens to be listed first.
function shortestNote(notes) {
    if (!notes.length) return null;
    return notes.reduce((shortest, n) => (n.length < shortest.length ? n : shortest));
}

function transformPerfume(row) {
    const notes = {
        top: splitNotes(row.notes_top),
        middle: splitNotes(row.notes_middle),
        base: splitNotes(row.notes_base)
    };
    const tags = [...new Set([...notes.top, ...notes.middle, ...notes.base])].slice(0, 3);
    // One tag per category (top/middle/base), each the shortest note in that category,
    // so every card's tag row is a single line and cards stay the same height —
    // otherwise longer note text wraps to a second line and pushes the cart button
    // down inconsistently between cards.
    const cardTags = [notes.top, notes.middle, notes.base].map(shortestNote).filter(Boolean);
    const categories =
        row.gender === "masculino"
            ? ["Men"]
            : row.gender === "femenino"
              ? ["Women"]
              : row.gender === "unisex"
                ? ["Unisex"]
                : [];

    return {
        id: row.id,
        name: row.model || row.name, // Modelo is the display title; falls back to the legacy name field
        brand: row.brand,
        model: row.model,
        gender: row.gender,
        description: row.description,
        categories, // Luxury Collection/Oriental still have no data source yet
        tags,
        cardTags,
        notes,
        price: row.price ?? null, // not collected by the dashboard yet
        stockQuantity: row.stock_quantity ?? null,
        inStock: row.stock_quantity != null ? row.stock_quantity >= 1 : null,
        image: row.image_url
    };
}

async function loadPerfumes() {
    try {
        const res = await fetch("/api/perfumes");
        const data = await res.json();
        products = Array.isArray(data) ? data.map(transformPerfume) : [];
    } catch (err) {
        console.error("Failed to load perfumes:", err);
        products = [];
    }
    render();
}

// ===== DOM refs =====
const grid = document.getElementById("grid");
const emptyState = document.getElementById("emptyState");
const searchInput = document.getElementById("searchInput");
const categoryFilters = document.getElementById("categoryFilters");
const modal = document.getElementById("modal");
const modalContent = document.getElementById("modalContent");
const starField = document.getElementById("starField");
const menuBtn = document.getElementById("menuBtn");
const exploreBtn = document.getElementById("exploreBtn");
const featuredBtn = document.getElementById("featuredBtn");
const drawer = document.getElementById("drawer");
const drawerOverlay = document.getElementById("drawerOverlay");
const closeDrawer = document.getElementById("closeDrawer");

let activeCategory = "all";
let searchTerm = "";

// ===== Star field (twinkle + slow falling drift, like the original canvas version) =====
(function generateStars() {
    const starCount = 120;
    const stars = [];

    for (let i = 0; i < starCount; i++) {
        const star = document.createElement("div");
        star.className = "star";

        const x = Math.random() * 100;
        const y = Math.random() * 70;
        const size = Math.random() * 2 + 0.5;
        const duration = Math.random() * 3 + 2;
        const delay = Math.random() * 5;
        const fallSpeed = Math.random() * 0.02 + 0.008;

        star.style.left = `${x}%`;
        star.style.width = `${size}px`;
        star.style.height = `${size}px`;
        star.style.setProperty("--duration", `${duration}s`);
        star.style.animationDelay = `${delay}s`;

        starField.appendChild(star);
        stars.push({ el: star, y, fallSpeed });
        star.style.top = `${y}%`;
    }

    function fall() {
        stars.forEach((s) => {
            s.y += s.fallSpeed;
            if (s.y > 70) {
                s.y = 0;
                s.el.style.left = `${Math.random() * 100}%`;
            }
            s.el.style.top = `${s.y}%`;
        });
        requestAnimationFrame(fall);
    }
    requestAnimationFrame(fall);
})();

// ===== Logo fallback (shows text logo until logo.png is added) =====
document.querySelectorAll('img[alt="NYX PERFUMES"]').forEach((img) => {
    img.addEventListener("error", () => {
        img.classList.add("hidden");
        const fallback = img.nextElementSibling;
        if (fallback) fallback.classList.remove("hidden");
    });
});

// ===== Stock badge helper =====
function stockBadge(inStock) {
    if (inStock === null || inStock === undefined) return "";
    return inStock
        ? `<span class="stock-badge in-stock">En Stock</span>`
        : `<span class="stock-badge out-of-stock">Sold Out</span>`;
}

// ===== Render grid =====
function render() {
    const term = searchTerm.trim().toLowerCase();

    const filtered = products.filter((p) => {
        const matchesCategory = activeCategory === "all" || p.categories.includes(activeCategory);
        const matchesSearch =
            !term ||
            p.name.toLowerCase().includes(term) ||
            p.tags.some((t) => t.toLowerCase().includes(term));
        return matchesCategory && matchesSearch;
    });

    grid.innerHTML = "";
    emptyState.classList.toggle("hidden", filtered.length > 0);

    filtered.forEach((p) => {
        const card = document.createElement("div");
        card.className = "glass-card bg-surface-container rounded-xl p-3 group border border-white/5 cursor-pointer";
        card.innerHTML = `
            <div class="relative aspect-[3/4] mb-4 overflow-hidden rounded-lg bg-surface-container-high flex items-center justify-center">
                ${
                    p.image
                        ? `<img alt="${escapeHtml(p.name)}" class="w-3/4 h-3/4 object-contain transition-transform duration-700 group-hover:scale-110" src="${escapeHtml(p.image)}"/>`
                        : `<span class="text-on-surface-variant text-[10px] uppercase tracking-widest">No Photo</span>`
                }
                <div class="absolute top-2 left-2">${stockBadge(p.inStock)}</div>
                ${
                    p.gender
                        ? `<div class="absolute top-2 right-2">
                            <span class="hidden md:inline-block text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-full backdrop-blur-sm ${genderBadgeClasses(p.gender)}">${escapeHtml(genderLabel(p.gender))}</span>
                            <span class="md:hidden flex items-center justify-center w-6 h-6 rounded-full backdrop-blur-sm text-[10px] font-bold ${genderBadgeClasses(p.gender)}" title="${escapeHtml(genderLabel(p.gender))}">${escapeHtml(genderAbbrev(p.gender))}</span>
                          </div>`
                        : ""
                }
            </div>
            <div class="text-center space-y-1.5">
                <p class="font-label-sm text-[10px] text-primary tracking-[0.2em] uppercase">${escapeHtml(p.brand) || "NYX"}</p>
                <h3 class="font-display-lg text-base text-on-surface leading-tight">${escapeHtml(p.name)}</h3>
                ${p.price != null ? `<p class="font-body-md text-xs text-on-surface-variant">$${p.price}</p>` : ""}
                <div class="flex justify-center gap-1 flex-nowrap">
                    ${p.cardTags.map((t) => `<span class="text-[8px] uppercase tracking-widest px-2 py-0.5 border border-white/10 rounded-full text-on-surface-variant whitespace-nowrap">${escapeHtml(t)}</span>`).join("")}
                </div>
                ${
                    p.inStock !== false
                        ? `<div class="flex justify-end pt-1">
                            <button type="button" class="add-to-cart-btn" data-id="${escapeHtml(p.id)}">
                                <span class="material-symbols-outlined text-[17px] icon-add">add_shopping_cart</span>
                                <span class="material-symbols-outlined text-[17px] icon-check">check</span>
                                <span class="material-symbols-outlined text-[17px] icon-remove">delete</span>
                            </button>
                          </div>`
                        : ""
                }
            </div>
        `;

        card.addEventListener("click", () => openModal(p));

        const addBtn = card.querySelector(".add-to-cart-btn");
        if (addBtn) {
            setCartButtonState(addBtn, isInCart(p.id));
            addBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                if (isInCart(p.id)) {
                    removeFromCart(p.id);
                    showToast("Eliminado del carrito");
                    setCartButtonState(addBtn, false);
                } else {
                    addToCart(p.id);
                    showToast("Agregado al carrito");
                    setCartButtonState(addBtn, true);
                }
            });
        }

        grid.appendChild(card);
        revealObserver.observe(card);
    });
}

// ===== Scroll reveal =====
const revealObserver = new IntersectionObserver(
    (entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add("revealed");
                revealObserver.unobserve(entry.target);
            }
        });
    },
    { threshold: 0.15 }
);

// ===== Modal =====
function openModal(p) {
    modalContent.innerHTML = `
        <div class="flex justify-between items-start mb-6">
            <p class="font-label-sm text-label-sm text-primary tracking-[0.2em] uppercase">${escapeHtml(p.brand) || "NYX"}</p>
            <button id="closeModal" class="text-on-surface-variant hover:text-on-surface">
                <span class="material-symbols-outlined">close</span>
            </button>
        </div>
        ${p.image ? `<img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" style="width:100%;height:260px;object-fit:contain" class="mb-6"/>` : ""}
        <h2 class="font-display-lg text-3xl text-on-surface mb-2">${escapeHtml(p.name)}</h2>
        ${p.gender ? `<span class="inline-block text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full mb-4 ${genderBadgeClasses(p.gender)}">${escapeHtml(genderLabel(p.gender))}</span>` : ""}
        <div class="flex items-center justify-between mb-6">
            ${p.price != null ? `<p class="font-body-md text-on-surface-variant">$${p.price}</p>` : "<span></span>"}
            ${stockBadge(p.inStock)}
        </div>
        ${p.description ? `<p class="font-body-md text-sm text-on-surface-variant mb-6">${escapeHtml(p.description)}</p>` : ""}
        <h3 class="font-label-sm text-label-sm text-primary uppercase tracking-[0.2em] mb-3">Notes</h3>
        <div class="space-y-2 font-body-md text-sm text-on-surface-variant mb-6">
            <p><b class="text-on-surface">Top:</b> ${escapeHtml(p.notes.top.join(", ")) || "—"}</p>
            <p><b class="text-on-surface">Middle:</b> ${escapeHtml(p.notes.middle.join(", ")) || "—"}</p>
            <p><b class="text-on-surface">Base:</b> ${escapeHtml(p.notes.base.join(", ")) || "—"}</p>
        </div>
        ${
            p.inStock === false
                ? `<button type="button" class="w-full py-3.5 rounded-full bg-white/5 text-on-surface-variant text-[11px] uppercase tracking-[0.15em] cursor-not-allowed" disabled>Agotado</button>`
                : `<button type="button" id="modalAddToCart" class="modal-cart-btn">
                    <span class="material-symbols-outlined text-base icon-add">add_shopping_cart</span>
                    <span class="material-symbols-outlined text-base icon-check">check</span>
                    <span class="material-symbols-outlined text-base icon-remove">delete</span>
                    <span class="label-add">Agregar a Carrito</span>
                    <span class="label-check">En el Carrito</span>
                    <span class="label-remove">Quitar del Carrito</span>
                  </button>`
        }
    `;
    modal.classList.remove("hidden");
    document.documentElement.classList.add("modal-open");
    modalContent.querySelector("#closeModal").addEventListener("click", closeModal);

    const modalAddBtn = modalContent.querySelector("#modalAddToCart");
    if (modalAddBtn) {
        setModalAddToCartState(modalAddBtn, isInCart(p.id));
        modalAddBtn.addEventListener("click", () => {
            const cardBtn = grid.querySelector(`.add-to-cart-btn[data-id="${p.id}"]`);

            if (isInCart(p.id)) {
                removeFromCart(p.id);
                showToast("Eliminado del carrito");
                setModalAddToCartState(modalAddBtn, false);
                if (cardBtn) setCartButtonState(cardBtn, false);
            } else {
                addToCart(p.id);
                showToast("Agregado al carrito");
                setModalAddToCartState(modalAddBtn, true);
                if (cardBtn) setCartButtonState(cardBtn, true);
            }
        });
    }
}

function setModalAddToCartState(btn, inCart) {
    btn.classList.toggle("in-cart", inCart);
}

function closeModal() {
    modal.classList.add("hidden");
    document.documentElement.classList.remove("modal-open");
}

modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
});

// ===== Filters =====
categoryFilters.querySelectorAll(".category-pill").forEach((btn) => {
    if (btn.dataset.category === "all") btn.classList.add("active");
    btn.addEventListener("click", () => {
        categoryFilters.querySelectorAll(".category-pill").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        activeCategory = btn.dataset.category;
        render();
    });
});

searchInput.addEventListener("input", (e) => {
    searchTerm = e.target.value;
    render();
});

// ===== Hero actions =====
exploreBtn.addEventListener("click", () => {
    document.getElementById("collection").scrollIntoView({ behavior: "smooth" });
});

featuredBtn.addEventListener("click", () => {
    const featured = products.find((p) => p.name === "Midnight Muse");
    if (featured) openModal(featured);
});

// ===== Nav Drawer =====
function openDrawer() {
    drawer.classList.add("open");
    drawerOverlay.classList.remove("hidden");
}

function closeDrawerFn() {
    drawer.classList.remove("open");
    drawerOverlay.classList.add("hidden");
}

menuBtn.addEventListener("click", openDrawer);
closeDrawer.addEventListener("click", closeDrawerFn);
drawerOverlay.addEventListener("click", closeDrawerFn);

drawer.querySelectorAll(".drawer-link[data-scroll]").forEach((link) => {
    link.addEventListener("click", (e) => {
        e.preventDefault();
        closeDrawerFn();
        document.getElementById(link.dataset.scroll).scrollIntoView({ behavior: "smooth" });
    });
});

// If already signed in, skip the login form and link straight to the dashboard.
async function updateAuthLink() {
    const loginLink = document.querySelector(".drawer-login");
    try {
        const res = await fetch("/api/session");
        const { loggedIn } = await res.json();
        if (loggedIn) {
            loginLink.textContent = "Dashboard";
            loginLink.setAttribute("href", "/dashboard");
        }
    } catch (err) {
        console.error("Failed to check session:", err);
    }
}
updateAuthLink();

// ===== Init =====
loadPerfumes();

// ===== Keep bottom-fixed floating buttons pinned during mobile scroll =====
// Mobile browsers resize the layout viewport asynchronously as their address bar
// collapses/expands mid-scroll, which is what makes position:fixed;bottom:Npx
// elements appear to jump a beat after scrolling starts. The visual viewport API
// reports the actually-visible area live, so we measure the gap against it and
// feed that back as a CSS var the buttons compensate for.
function syncMobileViewportOffset() {
    const vv = window.visualViewport;
    if (!vv) return;
    const offset = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
    document.documentElement.style.setProperty("--mobile-viewport-offset", `${offset}px`);
}

// Batches sync calls into one per animation frame — window "scroll" fires far more
// often than visualViewport's own events, so this catches the gap sooner without
// doing redundant work for events landing in the same frame.
let viewportSyncFrame = null;
function scheduleViewportSync() {
    if (viewportSyncFrame) return;
    viewportSyncFrame = requestAnimationFrame(() => {
        viewportSyncFrame = null;
        syncMobileViewportOffset();
    });
}

if (window.visualViewport) {
    syncMobileViewportOffset();
    window.visualViewport.addEventListener("resize", scheduleViewportSync);
    window.visualViewport.addEventListener("scroll", scheduleViewportSync);
    window.addEventListener("scroll", scheduleViewportSync, { passive: true });
}
