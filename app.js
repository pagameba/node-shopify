var express = require('express')
  , url = require("url")
  , request = require('request')
  , qs = require('qs')
  , app = express.createServer();
  
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
    secret: 'secret'
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
                    res.redirect(req.session.shopify.referer);
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

console.log('shopify app started on port 8003');
app.listen(8003);