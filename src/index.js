import express from "express";
import { MongoClient, ServerApiVersion, ObjectId } from "mongodb";
import cors from "cors";
import "dotenv/config";
import dns from "node:dns";

dns.setServers(["1.1.1.1", "8.8.8.8"]);

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.bjjofhw.mongodb.net/`;

const client = new MongoClient(uri, {
serverApi: {
version: ServerApiVersion.v1,
strict: true,
deprecationErrors: true,
},
});

async function run() {
try {
await client.connect();


const database = client.db("studiospaceDB");
const studiosCollection = database.collection("studios");

await client.db("admin").command({ ping: 1 });

console.log("Pinged your deployment. You successfully connected to MongoDB!");

app.get("/studios", async (req, res) => {
  const cursor = studiosCollection.find({});
  const studios = await cursor.toArray();

  res.send(studios);
});

app.get("/studios/:id", async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };

  const studio = await studiosCollection.findOne(query);

  res.send(studio);
});

app.post("/studios", async (req, res) => {
  const newStudio = req.body;

  console.log("Adding new studio:", newStudio);

  const result = await studiosCollection.insertOne(newStudio);
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
