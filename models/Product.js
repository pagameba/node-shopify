/* Product model 

This objects represents the products (map tilesets) on offer, includes a SKU
that is used for purchasing this product

*/
require('couch-ar').create('Product', {
  properties: {
    name: {},
    notes: {},
    tileset: {},
    extent: {}, //bbox or polygpn
    sku: {},
    region: {},
    tags: {},
    client: {},
    period: {},
    periodUnits: {},
    price: {},
    currency: {}
  }
}, function(that) {
  this.update = function(obj, fn) {
    for (var i in this.properties) {
      if (this.properties.hasOwnProperty(i) && typeof(obj[i])!='undefined') {
        this[i] = obj[i];
      }
    }
    if (obj.autoSave) {
      var that = this; 
      this.save(function(err, result) {
        // TODO is this === that in here?
        fn(err, that);
      });
    } else {
      fn(null, this);
    }
  };
  
  return that;
});
