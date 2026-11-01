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