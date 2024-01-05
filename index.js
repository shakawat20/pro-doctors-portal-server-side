const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express');
const cors = require('cors');
var jwt = require('jsonwebtoken')
require('dotenv').config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY)

const app = express();
const port = process.env.PORT || 9000

app.use(cors());
app.use(express.json())




const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.obhaluk.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization
    if (!authHeader) {
        return res.status(401).send({ message: 'UnAuthorized access' })
    }
    const token = authHeader.split(' ')[1]
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'Forbidden access' })
        }
        req.decoded = decoded // bar
        next()
    });

}




async function run() {
    try {
        client.connect();
        const serviceCollections = client.db('doctors-portal').collection("services");
        const bookingCollections = client.db('doctors-portal').collection("booking");
        const userCollections = client.db('doctors-portal').collection('users');
        const doctorsCollections = client.db('doctors-portal').collection('doctors');
        const paymentCollections = client.db('doctors-portal').collection('payments');


        const verifyAdmin = async (req, res, next) => {
            const requester = req.decoded.email;
            const requesterAccount = await userCollections.findOne({ email: requester })
            if (requesterAccount.role === 'admin') {
                next()
            }
            else {
                res.status(403).send({ message: 'forbidden' })
            }
        }





        app.get("/services", async (req, res) => {
            const query = {};
            const cursor = serviceCollections.find(query).project({ name: 1 });
            const services = await cursor.toArray();
            res.send(services);

        })

        app.get('/user', verifyJWT, async (req, res) => {
            const users = await userCollections.find().toArray();
            res.send(users);
        })


        app.get('/admin/:email', async (req, res) => {
            const email = req.params.email;
            const user = await userCollections.findOne({ email: email })
            const isAdmin = user.role === 'admin'
            res.send({ admin: isAdmin })
        })


        app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
            console.log("emon")
            const email = req.params.email;
            const filter = { email: email };
            const updateDoc = {
                $set: { role: 'admin' },
            };
            const result = await userCollections.updateOne(filter, updateDoc)
            res.send(result)



        })


        app.put('/user/:email', async (req, res) => {
            console.log("emon")
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email };
            const options = { upsert: true }

            const updateDoc = {
                $set: user,
            };
            const result = await userCollections.updateOne(filter, updateDoc, options)
            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })
            res.send({ result, token })
        })



        app.post('/booking', async (req, res) => {
            const booking = req.body;
            const query = { treatment: booking.treatment, date: booking.date, patient: booking.patient, slot: booking.slot }
            const exists = await bookingCollections.findOne(query);
            if (exists) {
                return res.send({ success: false, booking: exists })
            }
            const result = await bookingCollections.insertOne(booking);
            res.send({ success: true, result })
        })


        app.get('/booking', verifyJWT, async (req, res) => {
            const patient = req.query.patient;
            const authorization = req.headers.authorization
            const decodedEmail = req.decoded.email
            if (patient === decodedEmail) {
                const query = { patient: patient };
                const bookings = await bookingCollections.find(query).toArray();
                return res.send(bookings)
            }
            else {
                return res.status(403).send({ message: 'forbidden access' })
            }


        })


        app.get('/booking/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const booking = await bookingCollections.findOne(query);
            res.send(booking);

        })


        app.get('/available', async (req, res) => {
            const date = req.query.date
            //step 1: get all services
            const services = await serviceCollections.find().toArray();
            // step 2 : get the booking of that day
            const query = { date: date };
            const bookings = await bookingCollections.find(query).toArray();
            // step 3: for each service ,find bookings for that service
            services.forEach(service => {
                const serviceBookings = bookings.filter(b => b.treatment === service.name);
                const booked = serviceBookings.map(s => s.slot);
                const available = service.slots.filter(s => !booked.includes(s));
                service.slots = available
            })

            //step 2:get the booking of that day

            res.send(services)

        })




        app.post('/create-payment-intent', async (req, res) => {

            const booking = req.body;
            const price = booking.price;
            const amount = price * 100;

            const paymentIntent = await stripe.paymentIntents.create({

                currency: 'usd',
                amount: amount,
                "payment_method_types": [
                    "card"
                ]
            });

            res.send({
                clientSecret: paymentIntent.client_secret

            });

        })



        app.get('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
            const doctors = await doctorsCollections.find().toArray()
            res.send(doctors)
        })



        app.post('/payments', async (req, res) => {
            const payment = req.body;
            const result = await paymentCollections.insertOne(payment);
            const  id=payment.bookingId
            const filter ={_id:new ObjectId(id)}
            const updatedDoc={
                $set:{
                    paid: true,
                    transactionId:payment.transactionId
                }
            }
            const updatedResult=await bookingCollections.updateOne(filter,updatedDoc)
            res.send(result)

        })



        app.post('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorsCollections.insertOne(doctor)
            res.send(result)
        })
        
        app.delete('/doctor/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const result = await doctorsCollections.deleteOne(filter);
            res.send(result)
        })
    }

    finally {

        // await client.close()

    }
}
run().catch(console.dir)

app.get('/', async (req, res) => {
    res.send('hello world')
    console.log('doctor uncle')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})