// HeelsUp Design System Helper
(function() {
  'use strict';
  const DS = {
    // Colors from CSS vars
    colors: { primary: '#C0392B', blush: '#E8CCC5', cream: '#F6E7C6', ink: '#1a1a1a', bg: '#faf8f5' },
    // Format INR price
    price: (n) => '₹' + Number(n||0).toLocaleString('en-IN'),
    // Format date
    date: (d, short=false) => { if (!d) return '—'; const o = short ? {day:'2-digit',month:'short'} : {day:'2-digit',month:'short',year:'numeric'}; return new Date(d).toLocaleDateString('en-IN', o); },
    // Order status badge HTML
    statusBadge: (s) => { const m = {placed:['#dbeafe','#1d4ed8'],confirmed:['#dcfce7','#15803d'],processing:['#e0e7ff','#3730a3'],shipped:['#f3e8ff','#7e22ce'],out_for_delivery:['#fef9c3','#854d0e'],delivered:['#d1fae5','#065f46'],cancelled:['#fee2e2','#b91c1c'],returned:['#fef3c7','#92400e'],exchange_requested:['#fff7ed','#9a3412'],paid:['#dcfce7','#15803d'],pending:['#fef3c7','#b45309'],failed:['#fee2e2','#b91c1c'],refunded:['#e0e7ff','#3730a3']}; const [bg,c] = m[s]||['#f1f5f9','#64748b']; return '<span style="display:inline-flex;align-items:center;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.04em;background:'+bg+';color:'+c+';text-transform:uppercase">'+( s||'unknown').replace(/_/g,' ')+'</span>'; },
    // Product card HTML generator
    productCard: (p, opts={}) => {
      // p: {id, name, price, original_price, images, rating, review_count, is_new, is_trending, featured, stock}
      // opts: {wishlist:bool, lazyLoad:bool}
      const img = (p.images&&p.images[0]) || '/logo.png';
      const discount = p.original_price && p.original_price > p.price ? Math.round((1 - p.price/p.original_price)*100) : 0;
      const inWishlist = window.Wishlist ? window.Wishlist.isInWishlist(p.id) : false;
      const outOfStock = (p.stock || 0) <= 0;
      return `<div class="product-card" data-product-id="${p.id}">
        <a href="/product.html?id=${p.id}" class="product-img-wrap">
          <img src="${img}" alt="${p.name}" ${opts.lazyLoad!==false?'loading="lazy"':''} />
          ${discount ? '<span class="product-badge badge-discount">-'+discount+'%</span>' : ''}
          ${p.is_new ? '<span class="product-badge badge-new">New</span>' : ''}
          ${outOfStock ? '<span class="product-badge badge-oos">Out of Stock</span>' : ''}
        </a>
        <div class="product-info">
          <h3 class="product-name"><a href="/product.html?id=${p.id}">${p.name}</a></h3>
          <div class="product-price-row">
            <span class="product-price">${DS.price(p.price)}</span>
            ${p.original_price && p.original_price > p.price ? '<span class="product-mrp">'+DS.price(p.original_price)+'</span>' : ''}
          </div>
          ${(p.rating||0)>0 ? '<div class="product-rating"><span>★ '+Number(p.rating).toFixed(1)+'</span><span class="review-count">('+( p.review_count||0)+')</span></div>' : ''}
          <button class="btn-add-cart" onclick="event.preventDefault();Cart&&Cart.quickAdd(${p.id},'${p.name}',${p.price},'${img}')" ${outOfStock?'disabled':''}>Add to Cart</button>
        </div>
      </div>`;
    },
    // Skeleton loader cards
    skeletonCards: (n=4) => `<style>.hu-sk{background:linear-gradient(90deg,#f0ede8 25%,#e8e4dd 50%,#f0ede8 75%);background-size:200% 100%;animation:hu-shi 1.5s infinite;border-radius:8px}.hu-skc{background:#fff;border-radius:12px;padding:0;border:1px solid #ede8df;overflow:hidden}@keyframes hu-shi{0%{background-position:200% 0}100%{background-position:-200% 0}}</style>` + Array(n).fill(0).map(()=>`<div class="hu-skc"><div class="hu-sk" style="height:220px"></div><div style="padding:14px"><div class="hu-sk" style="height:14px;margin-bottom:8px"></div><div class="hu-sk" style="height:14px;width:60%;margin-bottom:8px"></div><div class="hu-sk" style="height:20px;width:40%"></div></div></div>`).join('')
  };
  window.DS = DS;
})();
