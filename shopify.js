var express = require('express')
  , EventEmitter = require('events').EventEmitter
  , emitter = new EventEmitter()
  , url = require("url")
  , request = require('request')
  , qs = require('qs')
  , cradle = require('cradle')
  , ar = require('couch-ar')
  , ccdb = require('connect-couchdb')(express)
  , app = express.createServer();
  
  
// the module is bootstrapped by calling it with an configuration object.  The
// module fires an 'init' event when all the startup processing is done, the 
// server may started by the calling module when this event is fired.
// e.g.
// require('manage.js')(config).on('init', function(server) {
//   server.listen(port);
// });
var clientName = ''
 , webhookDomain = '';
module.exports = function(config) {
  clientName = config.name;
  webhookDomain = config.smtp.webhookDomain;
  configureServer(config);
  return emitter;
}

// TODO: consider consolidating all this configure stuff into a common set of methods
// shared with 'app'

// bootstrapping begins.  Connect to the database and check for the following,
// creating them if necessary:
//
// - 'admin' user
// - client configuration document
//
// TODO: change admin to admin@mapsherpa.com and choose a better password :)
function configureServer(config) {
  ar.init({
    host: 'http://' + config.db.host,
    port: config.db.port,
    dbName: config.db.name,
    connectionOptions: {
      auth: {
        username: config.db.user,
        password: config.db.pass
      }
    },
    root: __dirname + '/models'
  }, function(cradleDb) {
    // globalize database connection so we can use cradle functions for attachments etc
    db = cradleDb;
    // check for session db existance
    var sessionDB = new (cradle.Connection)(config.db.host,config.db.port, {auth: {username: config.db.user, password: config.db.pass}}).database(config.db.session);
    sessionDB.exists(function(err, exists) {
      if (err) {
        console.log('error initializing session db', err);
      } else if (!exists) {
        sessionDB.create(function(){});
      }
      // synchronous, configure the express server
      configureApp(config);
      emitter.emit('init', app);
    });
  });
  
}


function configureApp(config) {
  
  var store = new ccdb({
    // Name of the database you would like to use for sessions.
    name: config.db.session,
  
    // Optional. How often expired sessions should be cleaned up.
    // Defaults to 600000 (10 minutes).
    reapInterval: 600000,
  
    // Optional. How often to run DB compaction against the session
    // database. Defaults to 300000 (5 minutes).
    // To disable compaction, set compactInterval to -1
    compactInterval: 300000,
    
    host: config.db.host,
    port: config.db.port,
    username: config.db.user,
    password: config.db.pass
  });
    
  
  app.configure(function(){
    app.set('views', __dirname + '/views');
    app.set('view engine', 'hbs');
    app.use(express.logger({
      format: ':method :url'
    }));
    app.use(express.methodOverride());
    app.use(express.bodyParser());
    app.use(express.cookieParser());
    app.use(express.session({
      secret: 'secret',
      store: store
    }));
    app.use(shopSetup());
    app.use(express.compiler({ src: __dirname + '/public', enable: ['less'] }));
    app.use(express.static(__dirname + '/public'));
    app.use(app.router);
  });
  

  function shopSetup(){
    return function (req, res, next) {
      console.log('shopSetup for:'+req.url);
      if (req.url.indexOf('authorize')>=0 ||req.url.indexOf('callback')>=0) {
         console.log('oauth shortcut');
         next();
      } else {
        if (!req.session.shopify) {
          console.log('new session');
          ar.Shop.findByOwner(clientName, function(shop){
              if (shop && shop.access_token) {
                console.log('shop record authorized in the DB');
                req.session.shopify = {
                  access_token: shop.access_token,
                  domain: shop.domain
                };
                if (req.session.shopify && req.session.shopify.access_token) {
                  next();
                } else {
                  console.log('store is not authorized');
                  res.json({success:false}, 500);
                }
              } else {
                console.log('store in DB is not authorized');
                res.json({success:false}, 500);
              }
          });
        } else {
          console.log('existing session');
          if (req.session.shopify.access_token) {
            next();
          } else {
            console.log('store is not authorized');
            res.json({success:false}, 500);
          }
        }
      }
    };
  }
  
  app.get('/', function(req, res, next) {
    res.render('index.hbs', {});
  });
  
  app.get('/authorize', function(req, res){
      req.session.shopify = {
       domain: req.query.shopName+'.myshopify.com',
       clientId: req.query.clientId,
       clientSecret: req.query.clientSecret,
       referer: req.headers.referer,
       scope: req.query.scope
      };
      
      ar.Shop.findByDomain(req.session.shopify.domain, function(shop){
          if (shop && shop.access_token) {
            console.log('shop record already authorized');
            req.session.shopify.access_token = shop.access_token;
            res.redirect(req.session.shopify.referer);
          } else {
            var authUrl = 'https://'+req.session.shopify.domain + '/admin/oauth/authorize';
            var params = {
              client_id: req.query.clientId,
              scope: req.query.scope,
            };
            authUrl += '?' + qs.stringify(params);
            console.log('redirecting to '+authUrl);
            res.redirect(authUrl);
          }
      });
  });
  
  app.get('/callback', function(req, res, next) {
      var authUrl = 'https://'+req.query.shop + '/admin/oauth/access_token';
      var params = {
        client_id: req.session.shopify.clientId,
        client_secret: req.session.shopify.clientSecret,
        code: req.query.code
      };
      console.log('issuing access token request to '+authUrl);
      console.log('with params '+ JSON.stringify(params));
      request.post({url: authUrl, json: params}, function (err, req2, body) {
          if (err) {
            console.log('Error requesting Shopify access token:'+authUrl);
            res.json({success: false, messages:[{type:'error', message:err}]}, 500);
          } else {
            if (body.err) {
              console.log("access token error:"+body.err);
              res.json({success:false}, 500);
            } else {
              if (req2.statusCode > 400) {
                console.log("access token 400 error:"+body);
                res.json({success:false}, req2.statusCode);
              } else {
                console.log('shopify token success:'+body.access_token);
                req.session.shopify.access_token = body.access_token;
                //store access_token in the DB
                //get the shop info and store in DB
                var storeInfoUrl = 'https://'+req.query.shop + '/admin/shop.json';
                request.get({
                   url: storeInfoUrl,
                   headers: {
                     'X-Shopify-Access-Token': req.session.shopify.access_token
                   }
                }, function(err, req3, body2) {
                    if (req3.statusCode < 400) {
                      console.log('shop info:'+body2);
                      var shop = JSON.parse(body2).shop;
                      shop.shopifyId = shop.id; //ID is special for ar
                      delete shop.id;           //rename it to shopifyId
                      shop.access_token = req.session.shopify.access_token;
                      console.log('set shop owner to:'+clientName);
                      shop.owner = clientName;
                      var shopifyStore = ar.Shop.create(shop);
                      shopifyStore.save(function(err,obj) {
                        if (err) {
                          console.log('error creating shopify record', err);
                          res.json({success:false}, 500);
                        } else {
                          console.log('created shopify record');
                          var webhook = {
                            "webhook": {
                              "topic": "orders/paid",
                              "address": webhookDomain + '/fullfill',
                              "format": "json"
                            }
                          };
                          var webhookUrl = 'https://'+req.query.shop + '/admin/webhooks.json';
                          request.post({
                              url: webhookUrl,
                              json: webhook,
                              headers: {
                                 'X-Shopify-Access-Token': req.session.shopify.access_token
                              }
                          }, function(err, req4, body4) {
                            if (req4.statusCode < 400) {
                              console.log('webhook info:'+body4);
                              res.redirect(req.session.shopify.referer);
                            } else {
                              console.log('error creating shopify webhook', JSON.stringify(req4));
                              res.json({success:false}, 500);
                            }
                          });
                        }
                      });
                    } else {
                      console.log('error getting store info');
                      res.json({success:false}, req3.statusCode);
                    }
                });
              }
            }
          }
      });
  });
  
  app.post('/fullfill', function(req, res, next) {
      console.log('fullfilling:'+JSON.stringify(req.body));
      res.json({success:true}, 200);
  });
  
  //Product routes
  //get all products
  app.get('/products', function(req, res, next) {
    var url = 'https://'+req.session.shopify.domain + '/admin/products.json';
    console.log('access token:'+req.session.shopify.access_token);
    request.get({
       url: url,
       headers: {
         'X-Shopify-Access-Token': req.session.shopify.access_token
       }
    }, function (err, req2, body) {
        if (err) {
          console.log('error reading shopify product'+ err);
          res.json({success:false}, 500);
        } else {
          var response;
          if (typeof(body) == 'string') {
            response = JSON.parse(body);
          } else {
            response = body;
          }
          if (response.errors) {
            console.log('error reading products:'+response.errors);
            res.json({success:false, message:response.errors}, 500);
          } else {
            var products = response.products;
            res.json({success: true, products: products}, 200);
          }
        }
    });
  });
  //get a single product
  app.get('/products/:id', function(req, res, next) {
    var url;
    if (req.params.id) {
      url =  'https://'+req.session.shopify.domain + '/admin/products/'+req.params.id+'.json';
    } else {
      console.log('product id missing');
      res.json({success:false, message:'product id missing'}, 500);
      return;
    }
    console.log('access token:'+req.session.shopify.access_token);
    console.log('accessing url:'+url);
    request.get({
       url: url,
       headers: {
         'X-Shopify-Access-Token': req.session.shopify.access_token
       }
    }, function (err, req2, body) {
        if (err) {
          console.log('error reading shopify product'+ err);
          res.json({success:false}, 500);
        } else {
          var response;
          if (typeof(body) == 'string') {
            console.log(body);
            response = JSON.parse(body);
          } else {
            response = body;
          }
          if (response.errors) {
            console.log('error reading products:'+response.errors);
            res.json({success:false, message:response.errors}, 500);
          } else {
            var products = response.product;
           res.json({success: true, products: products}, 200);
          }
        }
    });
  });
  app.post('/products', function(req, res, next) {
    var url =  'https://'+req.session.shopify.domain + '/admin/products.json';
    var params = JSON.parse(JSON.stringify(req.body));
    console.log('response headers:'+req.session.shopify.access_token);
    //params required by shopify
    var options = {
      "product": {
        "title": params.name,
        "vendor": 'mapsherpa',
        "product_type": 'online-map',
        "variants": [
          {
            "option1": params.tileset,
            "price": params.price,
            "sku": params.sku
          }
        ]
      }
    }      
    console.log('params:'+JSON.stringify(options));
    request.post({
       url: url, 
       json: options,
       headers: {
         'X-Shopify-Access-Token': req.session.shopify.access_token
       }
    }, function (err, req2, body) {
        console.log('creating product status:'+req2.statusCode);
        if (err) {
          console.log('error creating shopify product'+ err);
          res.json({success:false}, 500);
        } else {
          var response;
          if (typeof(body) == 'string') {
            console.log('response body:'+body);
            response = JSON.parse(body);
          } else {
            console.log('response body:'+JSON.stringify(body));
            response = body;
          }
          if (response.errors) {
            console.log('error creating product:'+response.errors);
            res.json({success:false, message:response.errors}, 500);
          } else {
            var products = response.product;
            console.log('product created');
            res.json({success: true, products: products}, 200);
          }
        }
    });
  });
  app.put('/products/:id', function(req, res, next) {
    var url =  'https://'+req.session.shopify.domain + '/admin/products/'+req.params.id+'.json';
    var params = JSON.parse(JSON.stringify(req.body));
    var options = {
      "product": {
        "title": params.name,
        "vendor": 'mapsherpa',
        "product_type": 'online-map',
        "variants": [
          {
            "option1": params.tileset,
            "price": params.price,
            "sku": params.sku
          }
        ]
      }
    }      
    request.put({
       url: url, 
       json: options,
       headers: {
         'X-Shopify-Access-Token': req.session.shopify.access_token
       }
    }, function (err, req2, body) {
        if (err) {
          console.log('error updating shopify product'+ err);
          res.json({success:false}, 500);
        } else {
          var response;
          if (typeof(body) == 'string') {
            console.log('response body:'+body);
            response = JSON.parse(body);
          } else {
            console.log('response body:'+JSON.stringify(body));
            response = body;
          }
          if (response.errors) {
            console.log('error updating product:'+response.errors);
            res.json({success:false, message:response.errors}, 500);
          } else {
            var products = response.product;
            console.log('product updated');
            res.json({success: true, products: products}, 200);
          }
        }
    });
  });
  app['delete']('/products/:id', function(req, res, next) {
    var url =  'https://'+req.session.shopify.domain + '/admin/products/'+req.params.id+'.json';
    request.del({
      url: url,
       headers: {
         'X-Shopify-Access-Token': req.session.shopify.access_token
       }
    }, function (err, req2, body) {
        if (req2.statusCode >= 400) {
          console.log('error deleting shopify product'+ err);
          res.json({success:false}, 500);
        } else {
          console.log('product deleted');
          res.json({success: true}, 200);
        }
    });
  });
  
  app.error(function(err, req, res) {
    console.log(err);
  });
}  
