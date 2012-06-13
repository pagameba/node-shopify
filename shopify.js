var express = require('express')
  , EventEmitter = require('events').EventEmitter
  , emitter = new EventEmitter()
  , url = require("url")
  , request = require('request')
  , qs = require('qs')
  , cradle = require('cradle')
  , ar = require('couch-ar')
  , ccdb = require('connect-couchdb')(express)
  , app = express.createServer()
  , shop
  ;
  
  
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
      configureShop(config, function(){
        configureApp(config);
        emitter.emit('init', app);
      });
    });
  });
  
}

function configureShop(config, next) {
  ar.Shop.findByDomain(config.shopify.shopDomain, function(aShop){
    if (aShop) {
      if (aShop.access_token) {
        shop = aShop;
        console.log('shop record authorized in the DB');
      } else {
        console.log('Shop record without token found');
        
        // TODO: can we reauthorize?
        
        process.exit();
      }
    } else {
      console.log('no shop record.');
    }
    next();
  });
}

function validShop(req, res, next) {
  if (shop && shop.access_token) {
    return next();
  } else {
    return next(new Error(401));
  }
}


function configureApp(config) {
  
  app.configure(function(){
    app.set('views', __dirname + '/views');
    app.set('view engine', 'hbs');
    app.use(express.logger({
      format: ':method :url'
    }));
    app.use(express.methodOverride());
    app.use(express.bodyParser());
    app.use(express.cookieParser());
    app.use(express.compiler({ src: __dirname + '/public', enable: ['less'] }));
    app.use(express.static(__dirname + '/public'));
    app.use(app.router);
  });
  

  app.get('/', function(req, res, next) {
    res.render('index.hbs', {});
  });
  
  var returnUrl;
  
  app.get('/authorize', function(req, res){
    returnUrl = decodeURIComponent(req.query.returnUrl);
    
    if (shop) {
      res.render('return', {
        title: 'Already Authorized',
        status: 'warn',
        message: 'MapSherpa already appears to be authorized with your Shopify account.  If things are not working correctly then please <a href="mailto:support@mapsherpa.com">Contact MapSherpa Support</a>.',
        returnUrl: returnUrl
      });
    } else if (!config.shopify || 
               !config.shopify.shopDomain || 
               !config.shopify.apiKey || 
               !config.shopify.sharedSecret || 
               !config.shopify.scope) {
      res.render('return', {
        title: 'Missing Shopify Configuration Information',
        status: 'error',
        message: 'Your MapSherpa account is missing required Shopify configuration information. Please <a href="mailto:support@mapsherpa.com">Contact MapSherpa Support</a>.',
        returnUrl: returnUrl
      });
    } else {
      var authUrl = 'https://'+config.shopify.shopDomain + '/admin/oauth/authorize';
      var params = {
        client_id: config.shopify.apiKey,
        scope: config.shopify.scope,
      };
      authUrl += '?' + qs.stringify(params);
      console.log('redirecting to '+authUrl);
      res.redirect(authUrl);
    }
  });
  
  app.get('/callback', function(req, res, next) {
      var accessToken;
    
      var authUrl = 'https://'+req.query.shop + '/admin/oauth/access_token';
      var params = {
        client_id: config.shopify.apiKey,
        client_secret: config.shopify.sharedSecret,
        code: req.query.code
      };
      console.log('issuing access token request to '+authUrl);
      console.log('with params '+ JSON.stringify(params));
      
      request.post({url: authUrl, json: params}, function (err, req2, body) {
          if (err) {
            console.log('Error requesting Shopify access token:'+authUrl);
            res.render('return', {
              title: 'Authorization Request Error',
              status: 'error',
              message: 'An error occurred when requesting authorization.  If this is a temporary network error, you can return to MapSherpa and try to authorize again.  If you see this message again, please <a href="mailto:support@mapsherpa.com">Contact MapSherpa Support</a>.',
              returnUrl: returnUrl
            });
          } else {
            if (body.err) {
              console.log("access token error:"+body.err);
              res.render('return', {
                title: 'Authorization Error',
                status: 'error',
                message: 'The following error occurred when requesting authorization: ' + err + '</p><p>Please <a href="mailto:support@mapsherpa.com">Contact MapSherpa Support</a>.',
                returnUrl: returnUrl
              });
            } else {
              if (req2.statusCode > 400) {
                console.log("access token 400 error:"+body);
                res.render('return', {
                  title: 'Authorization Error',
                  status: 'error',
                  message: 'The authorization request returned status code ' + req2.statusCode + '.</p><p>Please <a href="mailto:support@mapsherpa.com">Contact MapSherpa Support</a>.',
                  returnUrl: returnUrl
                });
              } else {
                console.log('shopify token success:'+body.access_token);
                accessToken = body.access_token;
                //store access_token in the DB
                //get the shop info and store in DB
                var storeInfoUrl = 'https://'+req.query.shop + '/admin/shop.json';
                request.get({
                   url: storeInfoUrl,
                   headers: {
                     'X-Shopify-Access-Token': accessToken
                   }
                }, function(err, req3, body2) {
                    if (req3.statusCode < 400) {
                      console.log('shop info:'+body2);
                      var shopInfo = JSON.parse(body2).shop;
                      shopInfo.shopifyId = shopInfo.id; //ID is special for ar
                      delete shopInfo.id;           //rename it to shopifyId
                      shopInfo.access_token = accessToken;
                      console.log('set shop owner to:'+clientName);
                      shopInfo.owner = clientName;
                      var shopifyStore = ar.Shop.create(shopInfo);
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
                                 'X-Shopify-Access-Token': accessToken
                              }
                          }, function(err, req4, body4) {
                            if (req4.statusCode < 400) {
                              console.log('webhook info:'+body4);
                              shop = shopifyStore;
                              res.redirect(returnUrl);
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
  
  app.post('/fullfill', validShop, function(req, res, next) {
      console.log('fullfilling:'+JSON.stringify(req.body));
      res.json({success:true}, 200);
  });
  
  //Product routes
  //get all products
  app.get('/products', function(req, res, next) {
    var url = 'https://'+shop.domain + '/admin/products.json';
    console.log('access token:'+shop.access_token);
    request.get({
       url: url,
       headers: {
         'X-Shopify-Access-Token': shop.access_token
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
  app.get('/products/:id', validShop, function(req, res, next) {
    var url;
    if (req.params.id) {
      url =  'https://'+shop.domain + '/admin/products/'+req.params.id+'.json';
    } else {
      console.log('product id missing');
      res.json({success:false, message:'product id missing'}, 500);
      return;
    }
    console.log('access token:'+shop.access_token);
    console.log('accessing url:'+url);
    request.get({
       url: url,
       headers: {
         'X-Shopify-Access-Token': shop.access_token
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
  app.post('/products', validShop, function(req, res, next) {
    var url =  'https://'+shop.domain + '/admin/products.json';
    var params = JSON.parse(JSON.stringify(req.body));
    console.log('response headers:'+shop.access_token);
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
         'X-Shopify-Access-Token': shop.access_token
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
  app.put('/products/:id', validShop, function(req, res, next) {
    var url =  'https://'+shop.domain + '/admin/products/'+req.params.id+'.json';
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
         'X-Shopify-Access-Token': shop.access_token
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
  app['delete']('/products/:id', validShop, function(req, res, next) {
    var url =  'https://'+shop.domain + '/admin/products/'+req.params.id+'.json';
    request.del({
      url: url,
       headers: {
         'X-Shopify-Access-Token': shop.access_token
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
