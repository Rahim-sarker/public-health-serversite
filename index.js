const express = require("express");
const cors = require("cors");
var jwt = require('jsonwebtoken');

require("dotenv").config();
var nodemailer = require('nodemailer');
var sgTransport = require('nodemailer-sendgrid-transport');

const stripe = require('stripe')(process.env.STRIPE_SECRECT_KEY);



const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.roz9e8l.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if(!authHeader){
    return res.status(401).send({message:'UnAuthorized access'});
  }
  const token = authHeader.split(' ')[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function(err, decoded) {
    if(err){
      return res.status(403).send({message:'Forbiden access'});
    }
   req.decoded = decoded;
   next();
  });
}

var EmailSenderOptions = {
  auth: {
      api_key: process.env.EMAIL_SENDER_KEY
  }
}
const emailClient = nodemailer.createTransport(sgTransport(EmailSenderOptions));


function sendPaymentConfirmationEmail(booking){
   const {patient, patientName, treatment, date, slot} = booking;

   var email = {
    to: patient,
    from: process.env.EMAIL_SENDER,
    subject: `We have received your payment for ${treatment} is on ${date} at ${slot} confirmed`,
    text: `Your Payment for this Appointment for ${treatment} is on ${date} at ${slot} confirmed`,
    html: `
      <div>
        <p>Hello ${patientName}</p>
        <h3>Thank you for your payment</h3>
        <h3>We have received your payment</h3>
        <p>Looking forward to see you  on ${date} at ${slot}.</p>
        <h3>Public Heath Service</h3>
      </div>
    `
};
  emailClient.sendMail(email, function(err, res) {
    if (err) { 
        console.log(err) 
    }
    console.log(res);
  });

}


function sendAppointmentEmail(booking){
  const {patient, patientName, treatment, date, slot,doctor} = booking;

  var email = {
   to: patient,
   from: process.env.EMAIL_SENDER,
   subject: `Your Appointment for ${treatment} is on ${date} at ${slot} confirmed`,
   text: `Your Appointment for ${treatment} is on ${date} at ${slot} confirmed`,
   html: `
     <div>
       <p>Hello ${patientName}</p>
       <h3>Your Appointment for ${treatment} is confirmed.</h3>
       <h3>Your Consultant <span style="color:green;">${doctor}</span>.</h3>
       <p>Looking forward to see you  on ${date} at ${slot}.</p>
       <h3>Public Health Service</h3>
     </div>
   `
};
 emailClient.sendMail(email, function(err, res) {
   if (err) { 
       console.log(err) 
   }
   console.log(res);
 });

}


async function run() {
  try {
    await client.connect();
    const serviceCollection = client
      .db("doctors_portal")
      .collection("services");

      await client.connect();
    const bookingCollection = client.db("doctors_portal").collection("bookings");
    const userCollection = client.db("doctors_portal").collection("users");
    const doctorCollection = client.db("doctors_portal").collection("doctors");
    const paymentCollection = client.db("doctors_portal").collection("payments");

    const verifyAdmin = async (req, res, next) =>{
      const requester = req.decoded.email;
      const requesterAccount = await userCollection.findOne({email: requester});
      if(requesterAccount.role === 'admin'){
        next();
      }
      else{
        res.status(403).send({message: 'Forbidden'});
      }

    }

   app.post('/create-payment-intent', verifyJWT, async(req,res)=>{
    const service = req.body;
    const price = service.price;
    const amount = price * 100;
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: 'usd',
      payment_method_types:['card']
    });
    res.send({clientSecret: paymentIntent.client_secret})
   })


    app.get("/service", async (req, res) => {
      const query = {};
      const cursor = serviceCollection.find(query).project({name: 1});
      
      //step-1 get all services
      const services = await cursor.toArray();
      res.send(services);
    });

   


    app.get('/user', verifyJWT, async(req,res)=>{
      const users = await userCollection.find().toArray();
      res.send(users);
    })

    app.get('/admin/:email', async(req,res) =>{
      const email =req.params.email;
      const user = await userCollection.findOne({email: email});
      const isAdmin = user.role === 'admin';
      res.send({admin: isAdmin});
    })


    app.put('/user/admin/:email' ,verifyJWT, verifyAdmin, async(req,res)=>{
      const email = req.params.email;
        const filter = {email: email}
        const updateDoc = {
         $set: {role: 'admin'},
       };
       const result = await userCollection.updateOne(filter,updateDoc);
       res.send(result); 
   })


    app.put('/user/:email' , async(req,res)=>{
       const email = req.params.email;
       const user =req.body;
       const filter = {email: email}
       const options = { upsert: true };

       const updateDoc = {
        $set: user,
      };

      const result = await userCollection.updateOne(filter,updateDoc, options);
      const token = jwt.sign({email:email}, process.env.ACCESS_TOKEN_SECRET,{ expiresIn: '1h' });
      res.send({result, token});

    })



  app.get('/available', async(req, res)=>{
     const date = req.query.date;

   //step-1 get all services

   const services = await serviceCollection.find().toArray();

   //step-2 get the booking of that day
  const query = {date: date}
  const bookings = await bookingCollection.find(query).toArray();

  //step 3 for each service , find the booking for that service

  services.forEach(service =>{
    const serviceBookings = bookings.filter(book => book.treatment === service.name);
    const bookedSlots = serviceBookings.map(book => book.slot);
    const available = service.slots.filter(slot => !bookedSlots.includes(slot));
    service.slots = available;
  })

   res.send(services)
  })


  app.get('/booking', verifyJWT, async(req,res)=>{
    const patient = req.query.patient;
    const decodedEmail = req.decoded.email;
    if(patient === decodedEmail){
      const query = {patient: patient}
      const bookings = await bookingCollection.find(query).toArray();
      return res.send(bookings);
    }
   else{
    return res.status(403).send({message:'forbidden access'});
   }
    
  });

  app.get('/booking/:id',verifyJWT, async(req,res) =>{
    const id = req.params.id;
    const query = {_id: ObjectId(id)};
    const booking = await bookingCollection.findOne(query);
    res.send(booking);
  })


app.post('/booking',async(req,res)=>{
  const booking = req.body;
  const query = {treatment: booking.treatment, date: booking.date, patient: booking.patient, doctor: booking.doctor}
  const exists = await bookingCollection.findOne(query);
  
  if(exists){
    return res.send({success: false, booking: exists})
  }

  const result = await bookingCollection.insertOne(booking);
  sendAppointmentEmail(booking);
  return res.send({success: true, result});
})

app.patch('/booking/:id',verifyJWT, async(req,res)=>{
  const id  = req.params.id;
  const payment = req.body;
  const filter ={_id: ObjectId(id)};
  const updateDoc = {
    $set:{
      paid: true,
      transationId: payment.transationId
    }
  }
  const result = await paymentCollection.insertOne(payment);
  const updatedBooking = await bookingCollection.updateOne(filter, updateDoc);
  res.send(updateDoc)
})

//Dotor finding start  here

app.get('/doctor/:email', async(req,res)=>{
  const email = req.params.email;
  const doctor = await doctorCollection.findOne({email:email});
  const isdoctor = doctor.role =='doctor';
  res.send({doctor:isdoctor})

})

//Dotor finding start  here
//patient list start from here

app.get('/patients', async(req,res)=>{
  const dname = req.query.doctor;
  const query = {patients:dname};
  const bookings = await bookingCollection.find(query).toArray();
  res.send(bookings)
});


app.delete('/patient/:id', async(req,res)=>{
   const id = req.params.id;
   const query = {_id: ObjectId(id)};
   const result = await bookingCollection.deleteOne(query);
   res.send(result);

})


//patient list start from here


app.get('/doctor', verifyJWT, verifyAdmin, async(req, res)=>{
  const doctors = await doctorCollection.find().toArray();
  res.send(doctors);
})

app.post('/doctor', verifyJWT, verifyAdmin, async(req,res)=>{
  const doctor = req.body;
  const result = await doctorCollection.insertOne(doctor);
  res.send(result);
})

app.delete('/doctor/:email', verifyJWT, verifyAdmin, async(req,res)=>{
  const email = req.params.email;
  const filter = {email: email};
  const result = await doctorCollection.deleteOne(filter);
  res.send(result);
})


  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Public health service Server");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
