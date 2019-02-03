/*jslint nomen: true, node: true, unparam: true, white: true*/
(function () {
  "use strict";

  var express = require('express'),
  app = express(),
  mysql = require('mysql'),
  nodemailer = require('nodemailer'),
  mysqlConnection = require(__dirname + '/../serverconfig/dbconnectmysqlnode.js'),
  myCTPConfig = require(__dirname + '/../serverconfig/myctpconfig.js'),
  port = require(__dirname + '/../serverconfig/nodeconfig.js').serverPort,
  staticSitePath = require(__dirname + '/../serverconfig/nodeconfig.js').staticSitePath,
  emailAuth = require(__dirname + '/../serverconfig/nodeconfig.js').emailAuth,
  imagesDir = require(__dirname + '/../serverconfig/nodeconfig.js').imagesDir,
  secure = require(__dirname + '/../serverconfig/nodeconfig.js').https,
  getRidOfEmptyItems = require('./functions/myfunctions').getRidOfEmptyItems,
  createComplicatedQuery = require('./functions/myfunctions').createComplicatedQuery,
  checkIfCat = require('./functions/myfunctions').checkIfCat,
  setCTPPriceRub = require(__dirname + '/../serverconfig/nodeconfig.js').setCTPPriceRub,
  setCTPPriceSeaRub = require(__dirname + '/../serverconfig/nodeconfig.js').setCTPPriceSeaRub,
  http = require('http'),
  httpServer,
  https = require('https'),
  path = require('path'),
  fs = require('fs'),
  request = require('request'),
  privateKey,
  certificate,
  credentials,
  httpsServer,
  ensureSecure;

  if (secure) {
    ensureSecure = function (req, res, next) {
      if(req.secure){
        // OK, continue
        return next();
      }
      // handle port numbers if you need non defaults
      // res.redirect('https://' + req.host + req.url); // express 3.x
      res.redirect('https://' + req.hostname + req.url); // express 4.x
    };
    app.all('*', ensureSecure);
    privateKey = fs.readFileSync('/etc/letsencrypt/live/seltex.ru/privkey.pem');
    certificate = fs.readFileSync('/etc/letsencrypt/live/seltex.ru/fullchain.pem');
    credentials = {key: privateKey, cert: certificate};
    httpsServer = https.createServer(credentials, app);
    httpsServer.listen(3000);
  } else {
    httpServer = http.createServer(app);
    httpServer.listen(3002);
  }

  app.set('view engine', 'ejs');
  app.use('/assets', express.static(__dirname + '/public'));
  app.use('/', express.static(__dirname + staticSitePath));
  app.use(function (req, res, next) {
    var allowedOrigins = ['http://1.local', 'https://fvolchek.net', 'https://www.fvolchek.net', 'http://localhost:4200', 'http://seltex.ru', 'http://www.seltex.ru'],
    origin = req.headers.origin;
    if (allowedOrigins.indexOf(origin) > -1) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    // res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    res.header("Access-Control-Allow-Methods", "DELETE, PUT");
    next();
  });

  app.get('/catalog/part/:partId', function (req, res) {

    var query = "SELECT p.description, p.comment, p.weight, inventoryManufacturers.fullName as manufacturerFullName, inventoryManufacturers.id as manufacturerID, inventoryNumbers.number, p.id, p.price, p.stock, p.ordered, p.link, p.msk from inventoryNumbers, inventory as p, inventoryManufacturers where inventoryManufacturers.id = inventoryNumbers.manufacturerId and inventoryNumbers.inventoryId = p.id and p.id = " + req.params.partId + " order by inventoryNumbers.main desc",
    connection = mysql.createConnection(mysqlConnection),
    part;

    connection.connect();

    connection.query(query, function (err, rows, fields) {
      if(rows){
        var i = 0;
        for(i = 0; i < rows.length; i += 1) {
          if (i === 0) {
            rows[0].allNumbersString = rows[0].number;
            rows[0].allNumbers = [];
            rows[0].allNumbers[rows[0].allNumbers.length] = {number: rows[0].number, manufacturer: rows[0].manufacturerFullName};
          } else {
            rows[0].allNumbersString = rows[0].allNumbersString + " " + rows[i].number;
            rows[0].allNumbers[rows[0].allNumbers.length] = {number: rows[i].number, manufacturer: rows[i].manufacturerFullName};

          }
        }
        // console.log(req.params.partId);
        // console.log(rows);
        part = rows[0];
        // if(part.manufacturerID === 5) {
        //       var qty = 1,
        //       partn = part.allNumbers[0].number,
        //       myForm = {
        //         format:'json',
        //         acckey:myCTPConfig.acckey,
        //         userid:myCTPConfig.userid,
        //         passw:myCTPConfig.passw,
        //         cust:myCTPConfig.cust,
        //         // loc:'01', /commented to see all warehouses
        //         partn:partn,
        //         qty:qty || '1'};
        //       request.post({url:'https://dev.costex.com:10443/WebServices/costex/partService/partController.php', form:myForm}, function(err, httpResponse, body){
        //           if (err) {
        //           return console.error('upload failed:', err);
        //         }
        //         console.log(body);
        //       })
        // }
        if(rows[0].allNumbers[0].number !== ""){
          query = "SELECT distinct p.description, p.comment, p.weight, inventoryNumbers.number, p.id, p.price, p.stock, p.ordered, p.link, p.msk from inventoryNumbers, inventory as p, inventoryManufacturers where inventoryManufacturers.id = inventoryNumbers.manufacturerId and inventoryNumbers.inventoryId = p.id and p.id <> " + req.params.partId + " and inventoryNumbers.number = '" + rows[0].allNumbers[0].number + "' order by p.stock desc, p.ordered desc";
          // console.log(query);
          connection.query(query, function (err, rows, fields) {
            if(err) {
              console.log(err);
            }
            // console.log(fields);
            if(rows.length) {
              part.analogs = rows;
            } else {
              part.analogs = [];
            }
            res.render('part', {part: part});
            // console.log(rows[0]);
          });
          connection.end();
        } else {
          part.analogs = [];
          res.render('part', {part: part});
          connection.end();
        }



        // res.render('part', {part: rows[0]});
      } else {
        res.render('notfound', {description: 'Страницы не существует'});
      }

    });


  });

  app.get(['/catalog/:search','/catalog/*'], function (req, res) {

    var query = '',
    connection = mysql.createConnection(mysqlConnection),
    search = '',
    items = [],
    n;

    //prepare sql query
    if (req.params.search) {
      search = req.params.search;
      search = search.split(' ');
      search = getRidOfEmptyItems(search);
      query = createComplicatedQuery(search);
      query = connection.query(query);
    } else {
      n = req.url.indexOf("?part");
      if (n > -1) {
        search = req.url.substring(9,n);
        search = search.replace(/%20/g, " ");
        req.params.search = search;
        search = search.split(' ');
        search = getRidOfEmptyItems(search);
        query = createComplicatedQuery(search);
        query = connection.query(query);
      } else {
        query = 'SELECT p.ID as id, p.Description AS description, p.Price as price, p.Numbers AS numbers, p.stock as stock, p.ordered as ordered, p.link as link, p.msk as msk from inventory1s as p order by p.Description';
        // query = "SELECT inventoryDescription.description as description, p.id as id, inventoryComments.comment as comment, inventoryManufacturers.fullName as manufacturerFullName, inventoryNumbers.number as number, inventoryNumbers.main as main, p.Price as price, p.stock as stock, p.ordered as ordered, p.link as link from inventory as p, inventoryNumbers, inventoryManufacturers, inventoryDescription, inventoryComments where p.id = inventoryNumbers.inventoryId and p.id = inventoryDescription.id and p.id = inventoryComments.id and  inventoryManufacturers.id = inventoryNumbers.manufacturerId and p.Description not like N'яя%' order by p.description";
        query = connection.query(query);
      }


    }


    query
    .on('result', function (row, index) {
      items[items.length] = row;
      // if(currentId !== row.id){
      //   currentId = row.id;
      //   resultIndex = items.length;
      //   items[resultIndex] = row;
      //   items[resultIndex].allNumbers = [];
      //   items[resultIndex].allNumbers[items[resultIndex].allNumbers.length] = row.number;
      // } else {
      //   if (row.main) {
      //     items[resultIndex].allNumbers.unshift(row.number);
      //     items[resultIndex].manufacturerFullName = row.manufacturerFullName;
      //   } else {
      //     items[resultIndex].allNumbers[items[resultIndex].allNumbers.length] = row.number;
      //   }
      // }

    })
    .on('end', function () {
      res.render('search', {searchPhrase: req.params.search, items: items, length: items.length});
    });

    connection.end();

  });


  /////////////////////////////////////////////////////////////////////////////
  //// send phone via email api
  /////////////////////////////////////////////////////////////////////////////
  //
  // app.post('/api/sendmail/:phone', function (req, res) {
  //   // create reusable transporter object using the default SMTP transport
  //   var transporter = nodemailer.createTransport({
  //     host: 'smtp.mail.ru',
  //     port: 587,
  //     secure: false, // secure:true for port 465, secure:false for port 587,
  //     auth: emailAuth
  //   }),
  //
  //   // setup email data with unicode symbols
  //   mailOptions = {
  //     from: '"SELTEX.RU" <sales2@seltex.ru>', // sender address
  //     to: 'sales@seltex.com', // list of receivers
  //     subject: 'Заказ звонка с сайта', // Subject line
  //     text: 'Перезвонить на номер: ' + req.params.phone, // plain text body
  //     html: '<h3>Перезвонить на номер: ' + req.params.phone + '</h3>' // html body
  //   };
  //
  //   // send mail with defined transport object
  //   transporter.sendMail(mailOptions, (error, info) => {
  //     if (error) {
  //       // return console.log(error);
  //       res.send(false);
  //     }
  //     res.send('OK');
  //     // console.log('Message %s sent: %s', info.messageId, info.response);
  //   });
  // });

  app.get('/api/quotectp/:part', function (req, res) {
    var qty = 1,
    partn = req.params.part,
    myForm = {
      format:'json',
      acckey:myCTPConfig.acckey,
      userid:myCTPConfig.userid,
      passw:myCTPConfig.passw,
      cust:myCTPConfig.cust,
      // loc:'01', /commented to see all warehouses
      partn:partn,
      qty:qty || '1'};
    request.post({url:'https://dev.costex.com:10443/WebServices/costex/partService/partController.php', form:myForm}, function(err, httpResponse, body){
        if (err) {
        return console.error('upload failed:', err);
      }
      body = JSON.parse(body);
      // console.log(body);
      var part = {};
      if (body.Locations.Location01) {
        part.price = Number(body.Locations.Location01.CustPrice.replace(/,/g, ''));
        part.mia = parseInt(body.Locations.Location01.NetQtyStock);
      } else if (body.Locations.Location04) {
        part.price = Number(body.Locations.Location04.CustPrice.replace(/,/g, ''));
        part.mia = 0;
      } else {
        part.price = 0;
        part.mia = 0;
        part.dal = 0;
        part.weight = 0;
      }
      if (body.Locations.Location04) {
        part.dal = parseInt(body.Locations.Location01.NetQtyStock)
      } else {
        part.dal = 0;
      }
      if (body.dblWeigthKgs) {
        part.weight = Number(body.dblWeigthKgs.replace(/,/g, ''));
      }
      // console.log(part);

      part.totalQty = part.mia + part.dal;
      if(part.totalQty > 12) {
        part.totalQty = "больше 12"
      }
      part.priceAvia = setCTPPriceRub(part.price, part.weight)//price count in rub
      part.priceSea = setCTPPriceSeaRub(part.price, part.weight)//price count in rub
      if(part.totalQty) {
        part.leadTime = "2-3 недели";
        part.leadTimeSea = "2-3 месяца";

      }
      part = {
        price: part.priceAvia,
        priceSea: part.priceSea,
        qty: part.totalQty,
        leadTime: part.leadTime,
        leadTimeSea: part.leadTimeSea

      }
      // console.log(part);


      res.send(part);
    })
  });

  app.get('/sis/*', function (req, res) {
    var sisPath = __dirname + staticSitePath + '/sis/index.html';
    // console.log(path);
    res.sendFile(path.join(sisPath));
  });

  app.get(/^\/(?!sis\/).*$/, function (req, res) {
    // app.get("/*", function (req, res) { //old get
    // console.log('inerror ');
    // res.sendFile(__dirname+'/dist/index.html');
    res.render('notfound', {description: 'Страницы не существует'});
  });

}());
