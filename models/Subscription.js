/* Subscription model

This object respresents the purchase of a product by the owner

*/
require('couch-ar').create('Subscription', {
  properties: {
    owner: {},
    productId: {},
    expires: [],
    purchased: {}
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
