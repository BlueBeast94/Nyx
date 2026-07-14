
const perfumes=[
    { id:1,name:"Coco Mademoiselle",brand:"Chanel",image:"https://fimgs.net/mdimg/perfume/375x500.611.jpg",notes:{top:["orange","bergamot"],middle:["rose"],base:["vanilla"]}},
    { id:2,name:"Sauvage",brand:"Dior",image:"https://fimgs.net/mdimg/perfume/375x500.31861.jpg",notes:{top:["pepper"],middle:["lavender"],base:["ambroxan"]}},
    { id:3,name:"Black Opium",brand:"YSL",image:"https://fimgs.net/mdimg/perfume/375x500.25324.jpg",notes:{top:["coffee"],middle:["jasmine"],base:["vanilla"]}}
    ];
    
    const grid=document.getElementById("grid");
    const drawer=document.getElementById("drawer");
    const overlay=document.getElementById("overlay");
    const modal=document.getElementById("modal");
    const modalContent=document.getElementById("modalContent");
    const brandFilters=document.getElementById("brandFilters");
    const menuBtn=document.getElementById("menuBtn");
    const closeDrawer=document.getElementById("closeDrawer");
    
    let activeBrands=new Set();
    
    menuBtn.onclick=()=>{drawer.classList.add("open");overlay.style.display="block"}
    closeDrawer.onclick=closeDrawerFn;
    overlay.onclick=closeDrawerFn;
    
    function closeDrawerFn(){drawer.classList.remove("open");overlay.style.display="none"}
    
    function renderBrands(){
    const brands=[...new Set(perfumes.map(p=>p.brand))];
    brandFilters.innerHTML="";
    
    brands.forEach(b=>{
    brandFilters.innerHTML+=`<label><input type="checkbox" value="${b}"> ${b}</label>`;
    });
    
    brandFilters.querySelectorAll("input").forEach(cb=>{
    cb.addEventListener("change",()=>{
    cb.checked?activeBrands.add(cb.value):activeBrands.delete(cb.value);
    render();
    });
    });
    }
    
    function render(){
    grid.innerHTML="";
    let filtered=perfumes.filter(p=>activeBrands.size===0||activeBrands.has(p.brand));
    
    filtered.forEach(p=>{
    const el=document.createElement("div");
    el.className="card";
    el.innerHTML=`<img src="${p.image}"><h4>${p.name}</h4><p>${p.brand}</p>`;
    el.onclick=()=>openModal(p);
    grid.appendChild(el);
    });
    }
    
    function openModal(p){
    modal.style.display="flex";
    modalContent.innerHTML=`
    <h2>${p.name}</h2>
    <p>${p.brand}</p>
    <img src="${p.image}" style="width:100%;height:220px;object-fit:contain">
    <h3 style="color:#eeb894">Notes</h3>
    <div class="note"><b>Top:</b> ${p.notes.top}</div>
    <div class="note"><b>Middle:</b> ${p.notes.middle}</div>
    <div class="note"><b>Base:</b> ${p.notes.base}</div>
    `;
    }
    
    modal.onclick=e=>{if(e.target===modal)modal.style.display="none"}
    
    renderBrands();
    render();



















    const canvas=document.getElementById("stars");
const ctx=canvas.getContext("2d");

let stars=[];
let w,h;

function resize(){
w=canvas.width=canvas.offsetWidth;
h=canvas.height=canvas.offsetHeight;

stars=[];
for(let i=0;i<120;i++){
stars.push({
x:Math.random()*w,
y:Math.random()*h,
r:Math.random()*1.2,
v:Math.random()*0.3+0.05
});
}
}
window.addEventListener("resize",resize);
resize();

function animate(){
ctx.clearRect(0,0,w,h);

for(let s of stars){
ctx.beginPath();
ctx.arc(s.x,s.y,s.r,0,Math.PI*2);
ctx.fillStyle="rgba(255,255,255,.8)";
ctx.fill();

s.y+=s.v;

if(s.y>h){
s.y=0;
s.x=Math.random()*w;
}
}

requestAnimationFrame(animate);
}
animate();
