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

module.exports = function(config) {
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
    app.use(express.compiler({ src: __dirname + '/public', enable: ['less'] }));
    app.use(express.static(__dirname + '/public'));
    app.use(app.router);
  });
  
  app.get('/', function(req, res, next) {
    res.render('index.hbs', {});
  });
  
  app.get('/authorize', function(req, res){
      req.session.shopify = {
       shopName: req.query.shopName,
       clientId: req.query.clientId,
       clientSecret: req.query.clientSecret,
       referer: req.headers.referer,
       scope: req.query.scope
      };
      var authUrl = 'https://'+req.query.shopName + '.myshopify.com/admin/oauth/authorize';
      var params = {
        client_id: req.query.clientId,
        scope: req.query.scope,
      };
      authUrl += '?' + qs.stringify(params);
      console.log('redirecting to '+authUrl);
      res.redirect(authUrl);
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
                req.session.shopify.accessToken = body.access_token;
                //store access_token in the DB
                //get the shop info and store in DB
                var storeInfoUrl = 'https://'+req.query.shop + '/admin/shop.json';
                request.get({
                 url: storeInfoUrl,
                 headers: {
                   'X-Shopify-Access-Token': body.access_token
                 }
                }, function(err, req3, body) {
                    if (req3.statusCode < 400) {
                      console.log('shop info:'+body);
                      var attrs = JSON.parse(body);
                      attrs.shop.shopifyId = attrs.shop.id; //ID is special for ar
                      delete attrs.shop.id;                 //rename it to shopifyId
                      var shopifyStore = ar.Shop.create(attrs.shop);
                      shopifyStore.save(function(err,obj) {
                        if (err) {
                          console.log('error creating shopify record', err);
                          res.json({success:false}, 500);
                        } else {
                          console.log('created shopify record');
                          res.redirect(req.session.shopify.referer);
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
  
  app.error(function(err, req, res) {
    console.log(err);
  });
}  
