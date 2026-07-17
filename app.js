// ===== Product catalog — loaded from the real backend (/api/perfumes) =====
// escapeHtml, genderLabel, genderBadgeClasses, and the cart helpers live in cart-utils.js
let products = [];

function splitNotes(str) {
    return (str || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}

function transformPerfume(row) {
    const notes = {
        top: splitNotes(row.notes_top),
        middle: splitNotes(row.notes_middle),
        base: splitNotes(row.notes_base)
    };
    const tags = [...new Set([...notes.top, ...notes.middle, ...notes.base])].slice(0, 3);
    const categories = row.gender === "masculino" ? ["Men"] : row.gender === "femenino" ? ["Women"] : [];

    return {
        id: row.id,
        name: row.model || row.name, // Modelo is the display title; falls back to the legacy name field
        brand: row.brand,
        model: row.model,
        gender: row.gender,
        description: row.description,
        categories, // Luxury Collection/Oriental/Unisex still have no data source yet
        tags,
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
        ? `<span class="stock-badge in-stock">In Stock</span>`
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
                        ? `<img alt="${escapeHtml(p.name)}" class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" src="${escapeHtml(p.image)}"/>`
                        : `<span class="text-on-surface-variant text-[10px] uppercase tracking-widest">No Photo</span>`
                }
                <div class="absolute top-2 left-2">${stockBadge(p.inStock)}</div>
                ${p.gender ? `<div class="absolute top-2 right-2"><span class="text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-full backdrop-blur-sm ${genderBadgeClasses(p.gender)}">${escapeHtml(genderLabel(p.gender))}</span></div>` : ""}
            </div>
            <div class="text-center space-y-1.5">
                <p class="font-label-sm text-[10px] text-primary tracking-[0.2em] uppercase">${escapeHtml(p.brand) || "NYX"}</p>
                <h3 class="font-display-lg text-base text-on-surface leading-tight">${escapeHtml(p.name)}</h3>
                ${p.price != null ? `<p class="font-body-md text-xs text-on-surface-variant">$${p.price}</p>` : ""}
                <div class="flex justify-center gap-1 flex-wrap">
                    ${p.tags.map((t) => `<span class="text-[8px] uppercase tracking-widest px-2 py-0.5 border border-white/10 rounded-full text-on-surface-variant">${escapeHtml(t)}</span>`).join("")}
                </div>
                ${
                    p.inStock !== false
                        ? `<div class="flex justify-end pt-1">
                            <button type="button" class="add-to-cart-btn w-8 h-8 rounded-full bg-white/5 border border-white/15 flex items-center justify-center text-on-surface hover:bg-primary hover:border-primary hover:text-on-primary transition-colors" aria-label="Agregar a carrito">
                                <span class="material-symbols-outlined text-[17px]">add_shopping_cart</span>
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
                addToCart(p.id);
                showToast("Agregado al carrito");
                setCartButtonState(addBtn, true);
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
                : `<button type="button" id="modalAddToCart" class="inline-flex items-center justify-center gap-2 w-full py-3.5 rounded-full border border-white/15 bg-white/5 backdrop-blur-sm hover:border-primary hover:bg-primary/10 transition-colors text-on-surface text-[11px] uppercase tracking-[0.15em]">
                    <span class="material-symbols-outlined text-base">add_shopping_cart</span>
                    Agregar a Carrito
                  </button>`
        }
    `;
    modal.classList.remove("hidden");
    modalContent.querySelector("#closeModal").addEventListener("click", closeModal);

    const modalAddBtn = modalContent.querySelector("#modalAddToCart");
    if (modalAddBtn) {
        setModalAddToCartState(modalAddBtn, isInCart(p.id));
        modalAddBtn.addEventListener("click", () => {
            addToCart(p.id);
            showToast("Agregado al carrito");
            setModalAddToCartState(modalAddBtn, true);
        });
    }
}

function setModalAddToCartState(btn, inCart) {
    btn.disabled = inCart;
    if (inCart) {
        btn.classList.remove("border-white/15", "bg-white/5", "hover:border-primary", "hover:bg-primary/10", "text-on-surface");
        btn.classList.add("border-green-400/40", "bg-green-500/15", "text-green-300", "cursor-default");
        btn.innerHTML = `<span class="material-symbols-outlined text-base">check</span> En el carrito`;
    } else {
        btn.classList.remove("border-green-400/40", "bg-green-500/15", "text-green-300", "cursor-default");
        btn.classList.add("border-white/15", "bg-white/5", "hover:border-primary", "hover:bg-primary/10", "text-on-surface");
        btn.innerHTML = `<span class="material-symbols-outlined text-base">add_shopping_cart</span> Agregar a Carrito`;
    }
}

function closeModal() {
    modal.classList.add("hidden");
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
