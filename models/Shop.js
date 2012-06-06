/* Shop model 

This objects represents the shopify shop object which handles the e-commerce

*/
require('couch-ar').create('Shop', {
  properties: {
    access_token: {},
    customer_email: {},
    domain: {},
    email: {},
    shopifyId: {},
    name: {},
    timezone: {},
    shop_owner: {},
    owner: {},
    taxes_included: {},
    tax_shipping: {},
    myshopify_domain: {}
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
  
  this.asJSON = function() {
    return {
      customer_email: this.customer_email,
      domain: this.domain,
      email: this.email,
      shopifyId: this.shopifyId,
      name: this.name,
      owner: this.owner,
      timezone: this.timezone,
      shop_owner: this.shop_owner,
      taxes_included: this.taxes_included,
      tax_shipping: this.tax_shipping,
      myshopify_domain: this.myshopify_domain
    }
  };
  
  return that;
});
