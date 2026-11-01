import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import cors from "cors";
import "dotenv/config";
import dns from "node:dns";

dns.setServers(["1.1.1.1", "8.8.8.8"]);

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.bjjofhw.mongodb.net/`;

const client = new MongoClient(uri);

async function run() {
  try {
    await client.connect();

    const database = client.db("studiospaceDB");
    const studios = database.collection("studios");
    const bookings = database.collection("bookings");

    await client.db("admin").command({ ping: 1 });

    console.log("Pinged your deployment. You successfully connected to MongoDB!");

    app.get("/studios", async (req, res) => {
      const cursor = studios.find({});
      const allStudios = await cursor.toArray();

      res.send(allStudios);
    });

    app.post("/studios", async (req, res) => {
      const newStudio = req.body;

      console.log("Adding new studio:", newStudio);

      const result = await studios.insertOne(newStudio);

      res.send(result);
    });

    app.get("/studios/:id", async (req, res) => {
      const id = req.params.id;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid Studio ID" });
      }

      const query = { _id: new ObjectId(id) };
      const result = await studios.findOne(query);

      if (!result) {
        return res.status(404).send({ message: "Studio not found" });
      }

      res.send(result);
    });

    app.patch("/studios/:id", async (req, res) => {
      const id = req.params.id;
      const { hostEmail, ...updatedStudio } = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid Studio ID" });
      }

      const filter = {
        _id: new ObjectId(id),
        hostEmail: hostEmail,
      };

      const existingStudio = await studios.findOne(filter);

      if (!existingStudio) {
        return res.status(403).send({
          message: "You cannot update this studio",
        });
      }

      const updatedDoc = {
        $set: updatedStudio,
      };

      const result = await studios.updateOne(filter, updatedDoc);

      res.send(result);
    });

    app.delete("/studios/:id", async (req, res) => {
      const id = req.params.id;
      const { hostEmail } = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid Studio ID" });
      }

      const query = {
        _id: new ObjectId(id),
        hostEmail: hostEmail,
      };

      const existingStudio = await studios.findOne(query);

      if (!existingStudio) {
        return res.status(403).send({
          message: "You cannot delete this studio",
        });
      }

      const result = await studios.deleteOne(query);

      res.send(result);
    });

    app.get("/bookings", async (req, res) => {
      try {
        const email = req.query.email;

        if (typeof email !== "string" || email.trim() === "") {
          return res.status(400).send({
            message: "Customer email is required",
          });
        }

        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailPattern.test(email.trim())) {
          return res.status(400).send({
            message: "Invalid customer email",
          });
        }

        const query = {
          customerEmail: email.trim().toLowerCase(),
        };

        const cursor = bookings.find(query).sort({ createdAt: -1 });
        const customerBookings = await cursor.toArray();

        res.send(customerBookings);
      } catch (error) {
        console.error(error);

        res.status(500).send({
          message: "Failed to fetch bookings",
        });
      }
    });

    app.post("/bookings", async (req, res) => {
      try {
        const newBooking = req.body;

        if (
          newBooking === null ||
          typeof newBooking !== "object" ||
          Array.isArray(newBooking)
        ) {
          return res.status(400).send({
            message: "Invalid booking information",
          });
        }

        const {
          studioId,
          customerEmail,
          bookingDate,
          startTime,
          endTime,
          totalPrice,
        } = newBooking;

        if (
          typeof studioId !== "string" ||
          typeof customerEmail !== "string" ||
          typeof bookingDate !== "string" ||
          typeof startTime !== "string" ||
          typeof endTime !== "string" ||
          totalPrice === undefined
        ) {
          return res.status(400).send({
            message: "Missing or invalid booking information",
          });
        }

        if (!ObjectId.isValid(studioId)) {
          return res.status(400).send({
            message: "Invalid Studio ID",
          });
        }

        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailPattern.test(customerEmail.trim())) {
          return res.status(400).send({
            message: "Invalid customer email",
          });
        }

        const studio = await studios.findOne({
          _id: new ObjectId(studioId),
        });

        if (!studio) {
          return res.status(404).send({
            message: "Studio not found",
          });
        }

        const datePattern = /^\d{4}-\d{2}-\d{2}$/;

        if (!datePattern.test(bookingDate)) {
          return res.status(400).send({
            message: "Invalid booking date",
          });
        }

        const parsedDate = new Date(`${bookingDate}T00:00:00.000Z`);

        if (
          Number.isNaN(parsedDate.getTime()) ||
          parsedDate.toISOString().slice(0, 10) !== bookingDate
        ) {
          return res.status(400).send({
            message: "Invalid booking date",
          });
        }

        const today = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Dhaka",
        }).format(new Date());

        if (bookingDate < today) {
          return res.status(400).send({
            message: "Booking date cannot be in the past",
          });
        }

        const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

        if (
          !timePattern.test(startTime) ||
          !timePattern.test(endTime)
        ) {
          return res.status(400).send({
            message: "Invalid booking time",
          });
        }

        if (startTime >= endTime) {
          return res.status(400).send({
            message: "End time must be after start time",
          });
        }

        if (
          typeof totalPrice !== "number" ||
          !Number.isFinite(totalPrice) ||
          totalPrice <= 0
        ) {
          return res.status(400).send({
            message: "Total price must be a positive number",
          });
        }

        const existingBooking = await bookings.findOne({
          studioId,
          bookingDate,
          status: "Confirmed",
          startTime: { $lt: endTime },
          endTime: { $gt: startTime },
        });

        if (existingBooking) {
          return res.status(409).send({
            message: "This studio is already booked for this time",
          });
        }

        const booking = {
          studioId,
          customerEmail: customerEmail.trim().toLowerCase(),
          bookingDate,
          startTime,
          endTime,
          totalPrice,
          status: "Pending",
          createdAt: new Date(),
        };

        const result = await bookings.insertOne(booking);

        res.status(201).send({
          message: "Booking created successfully",
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error(error);

        res.status(500).send({
          message: "Failed to create booking",
        });
      }
    });
  } catch (error) {
    console.error(error);
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("StudioSpace Server is Running!");
});

app.listen(port, () => {
  console.log(`StudioSpace Server is running on port ${port}`);
});