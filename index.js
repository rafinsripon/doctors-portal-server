const express  = require('express')
const cors = require('cors')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const app = express();
const port = process.env.PORT || 5000
require('dotenv').config();
const nodemailer = require("nodemailer");
const mg = require('nodemailer-mailgun-transport');
const stripe = require("stripe")(process.env.STRIPE_SECRET);
require('colors');

//midle ware
app.use(cors());
app.use(express.json());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.0mxdn2v.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

//send email function
function sendEmailBooking(booking){
    const {email, appointmentDate, treatment, slot} = booking;
    const auth = {
        auth: {
          api_key: process.env.EMAIL_SEND_KEY,
          domain: process.env.EMAIL_SEND_DOMAIN
        }
      }
      const transporter = nodemailer.createTransport(mg(auth));

     transporter.sendMail({
        from: "SENDER_EMAIL", // verified sender email
        to: email, // recipient email
        subject: `your Appoinments for is ${treatment} confirmed`, // Subject line
        text: "Hello world!", // plain text body
        html: `
        <h2>Your Appointment is confirm ${treatment}</h2> 
        <div>
            <p>Please Visit Us form ${appointmentDate} a slot ${slot}</p>
            <p>thenks for doctors portal</p>
        </div>
        
        `, // html body
      }, function(error, info){
        if (error) {
          console.log(error);
        } else {
          console.log('Email sent: ' + info.response);
        }
      });
}

function verifyJWT(req, res, next) {
    // console.log('token', req.headers.authorization)
    const authHeader = req.headers.authorization;
    if(!authHeader){
        return res.status(401).send('unauthorize access');
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN, function(err, decoded){
        if(err){
            return res.status(403).send({message: 'Forbidden Access'})
        }
        req.decoded = decoded;
        next();
    })
}

async function run() {
    try{
     const appointmentOptionCollection = client.db('doctorsPortal').collection('appointmentOptions');
     const bookingsCollection = client.db('doctorsPortal').collection('bookings');
     const usersCollection = client.db('doctorsPortal').collection('users');
     const doctorsCollection = client.db('doctorsPortal').collection('doctors');
     const paymentsCollection = client.db('doctorsPortal').collection('payments');

     //NOte: make sure you use verify admin after verify JWT
     const verifyAdmin = async(req, res, next) => {
        const decodedEmail = req.decoded.email;
         const query = {email: decodedEmail}
         const user = await usersCollection.findOne(query);

         if(user?.role !== 'admin'){
            return res.status(403).send({message: 'Forbidden Access'})
         }
         next();
     }




    // Use Aggregate to query multiple collection and then merge data
    app.get('/appointmentOptions', async (req, res) => {
        const date = req.query.date;
        const query = {};
        const options = await appointmentOptionCollection.find(query).toArray();

        // get the bookings of the provided date
        const bookingQuery = { appointmentDate: date }
        const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray();

        // code carefully :D
        options.forEach(option => {
            const optionBooked = alreadyBooked.filter(book => book.treatment === option.name);
            const bookedSlots = optionBooked.map(book => book.slot);
            const remainingSlots = option.slots.filter(slot => !bookedSlots.includes(slot))
            option.slots = remainingSlots;
        })
        res.send(options);
    });

    //Specialty Name signle
    app.get('/appointmentSpecialty', async(req, res) => {
        const query = {};
        const result = await appointmentOptionCollection.find(query).project({name: 1}).toArray();
        res.send(result);
    })


    //get Specific email query for dashboard
    app.get('/bookings',verifyJWT, async(req, res) => {
        const email = req.query.email;
        const decodedEmail = req.decoded.email;
        if(email !== decodedEmail){
            return res.status(403).send({message: 'Forbidden Access'})
        }
        const query = {email: email}
        const bookings = await bookingsCollection.find(query).toArray();
        res.send(bookings)
    })
    //prayment single specific id
    app.get('/bookings/:id', async(req, res) => {
        const id = req.params.id;
        const query = {_id: ObjectId(id)};
        const booking = await bookingsCollection.findOne(query);
        res.send(booking)
    })
     
     //client to server data, post method
     app.post('/bookings', async(req, res) => {
        const booking = req.body;
        const query = {
            appointmentDate: booking.appointmentDate,
            email: booking.email,
            treatment: booking.treatment
        }
        const alreadyBooked = await bookingsCollection.find(query).toArray();
        if(alreadyBooked.length){
            const message = `You Already Have a Booking On ${booking.appointmentDate}`
            return res.send({acknowledged: false, message})
        }
        const result = await bookingsCollection.insertOne(booking);
        //send email users

        res.send(result);
     })

     //get payment api form stripe payment
     app.post('/create-payment-intent', async(req, res) => {
        const booking = req.body;
        const price = booking.price;
        const amount = price * 100;

        const paymentIntent = await stripe.paymentIntents.create({
            currency: "usd",
            amount: amount,
            "payment_method_types": [
                "card"
            ]
        });
        res.send({
            clientSecret: paymentIntent.client_secret,
          });
     })
     //store payment database
     app.post('/payments', async(req, res) => {
        const payment = req.body;
        const result = await paymentsCollection.insertOne(payment);
        const id = payment.bookingId;
        const filter = {_id: ObjectId(id)}
        const updatedDoc = {
            $set: {
                paid: true,
                transactionId: payment.transactionId
            }
        }
        const updatedResult = await bookingsCollection.updateOne(filter, updatedDoc)
        res.send(result);
     })


     //jwt token access
     app.get('/jwt', async(req, res) => {
        const email = req.query.email;
        const query = {email: email}
        const user = await usersCollection.findOne(query);
        if(user){
            const token = jwt.sign({email}, process.env.ACCESS_TOKEN, {expiresIn: '1h'});
            return res.send({accessToken: token});
        }
        res.status(403).send({accessToken: ''})
     })
     //all user get
     app.get('/users', async(req, res) => {
        const query = {};
        const users = await usersCollection.find(query).toArray();
        res.send(users);
     })

     //user admin kina check
     app.get('/users/admin/:email', async(req, res) => {
        const email = req.params.email;
        const query = {email}
        const user = await usersCollection.findOne(query);
        res.send({isAdmin: user?.role === 'admin'})
     })

     //user create method - post
     app.post('/users', async(req, res) => {
        const user = req.body;
        const result = await usersCollection.insertOne(user);
        res.send(result)
     })

     //user admin / update role
     app.put('/users/admin/:id',verifyJWT, verifyAdmin, async(req, res) => {
        const id = req.params.id;
        const filter = {_id: ObjectId(id)}
        const options = {upsert : true}
        const updatedDoc = {
            $set: {
                role: 'admin'
            }
        }
        const result = await usersCollection.updateOne(filter, updatedDoc, options);
        res.send(result)
     })

    // temporary to update price field on appointment options
        // app.put('/addPrice', async (req, res) => {
        //     const filter = {}
        //     const options = { upsert: true }
        //     const updatedDoc = {
        //         $set: {
        //             price: 99
        //         }
        //     }
        //     const result = await appointmentOptionCollection.updateMany(filter, updatedDoc, options);
        //     res.send(result);
        // })

     //doctr collect get
     app.get('/doctors', verifyJWT, verifyAdmin, async(req, res) => {
        const query = {};
        const doctors = await doctorsCollection.find(query).toArray();
        res.send(doctors)
     })
     //doctor collection
     app.post('/doctors', verifyJWT, verifyAdmin, async(req, res) => {
        const doctor = req.body;
        const result = await doctorsCollection.insertOne(doctor);
        res.send(result)
     })

     //doctors delete
     app.delete('/doctors/:id', verifyJWT, verifyAdmin, async(req, res) => {
        const id = req.params.id;
        const query = {_id: ObjectId(id)}
        const result = await doctorsCollection.deleteOne(query);
        res.send(result)
     })


    }
    catch(error){
        console.log(error.name.bgRed, error.message)
    }
}
run();



/*
 * naming convention
 * Booking / orders / users
 *app.get('/bookins')
 *app.get('/bookins/:id')
 *app.post('/bookins')
 *app.put('/bookins/:id')
 *app.delete('/bookins/:id')
 */


app.get('/', (req, res) => {
    res.send('Doctors Portal server Running')
})

app.listen(port, () => {
    console.log(`Doctors portal server runnig on port ${port}`.bgMagenta.bold);
})


