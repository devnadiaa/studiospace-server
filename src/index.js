import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import cors from "cors";
import "dotenv/config";
import dns from "node:dns";
import {
  toNodeHandler,
  fromNodeHeaders,
} from "better-auth/node";
import { createAuth } from "./auth.js";

dns.setServers(["1.1.1.1", "8.8.8.8"]);

const app = express();
const port = process.env.PORT || 5000;

const allowedOrigins = [
  "http://localhost:3000",
  ...(process.env.CLIENT_URL ? [process.env.CLIENT_URL] : []),
];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  })
);

const uri = `mongodb://${encodeURIComponent(
  process.env.DB_USER
)}:${encodeURIComponent(
  process.env.DB_PASS
)}@ac-9skxeq4-shard-00-00.bjjofhw.mongodb.net:27017,ac-9skxeq4-shard-00-01.bjjofhw.mongodb.net:27017,ac-9skxeq4-shard-00-02.bjjofhw.mongodb.net:27017/?ssl=true&replicaSet=atlas-kaeoio-shard-0&authSource=admin`;

const client = new MongoClient(uri);

let databasePromise = null;
let studios;
let bookings;
let reviews;
let auth;
let authHandler;

const connectToDatabase = async () => {
  if (databasePromise === null) {
    databasePromise = (async () => {
      await client.connect();

      const database = client.db("studiospaceDB");

      studios = database.collection("studios");
      bookings = database.collection("bookings");
      reviews = database.collection("reviews");

      auth = createAuth(database, client);
      authHandler = toNodeHandler(auth);

      await client.db("admin").command({ ping: 1 });

      console.log(
        "Pinged your deployment. You successfully connected to MongoDB!"
      );
    })().catch((error) => {
      databasePromise = null;
      throw error;
    });
  }

  return databasePromise;
};

app.use(async (req, res, next) => {
  try {
    await connectToDatabase();
    next();
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Database connection failed",
    });
  }
});

app.all("/api/auth/*splat", (req, res) => {
  return authHandler(req, res);
});

app.use(express.json());

const requireAuth = async (req, res, next) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session?.user) {
      return res.status(401).send({
        message: "Please login to continue",
      });
    }

    req.user = session.user;
    req.session = session.session;

    next();
  } catch (error) {
    next(error);
  }
};

const getUserOwnershipQuery = (user) => {
  return {
    $or: [
      { hostId: user.id },
      { hostEmail: user.email.trim().toLowerCase() },
    ],
  };
};

const getCustomerBookingQuery = (user) => {
  return {
    $or: [
      { customerId: user.id },
      { customerEmail: user.email.trim().toLowerCase() },
    ],
  };
};

const getHostBookingQuery = async (user) => {
  const ownedStudios = await studios
    .find(getUserOwnershipQuery(user))
    .project({ _id: 1 })
    .toArray();

  return ownedStudios.map((studio) => studio._id.toString());
};

const getStudioRating = async (studioId) => {
  const result = await reviews
    .aggregate([
      {
        $match: {
          studioId,
        },
      },
      {
        $group: {
          _id: "$studioId",
          averageRating: { $avg: "$rating" },
          reviewCount: { $sum: 1 },
        },
      },
    ])
    .toArray();

  return {
    rating: result.length > 0
      ? Number(result[0].averageRating.toFixed(1))
      : 0,
    reviewCount: result.length > 0
      ? result[0].reviewCount
      : 0,
  };
};

app.get("/", (req, res) => {
  res.send("StudioSpace Server is Running!");
});

app.get("/studios", async (req, res, next) => {
  try {
    const allStudios = await studios.find({}).toArray();

    const studiosWithRatings = await Promise.all(
      allStudios.map(async (studio) => {
        const { rating, reviewCount } = await getStudioRating(
          studio._id.toString()
        );

        return {
          ...studio,
          rating,
          reviewCount,
        };
      })
    );

    res.send(studiosWithRatings);
  } catch (error) {
    next(error);
  }
});

app.get("/my-studios", requireAuth, async (req, res) => {
  try {
    const myStudios = await studios
      .find(getUserOwnershipQuery(req.user))
      .sort({ createdAt: -1 })
      .toArray();

    res.send(myStudios);
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Failed to fetch your studios",
    });
  }
});

app.post("/studios", requireAuth, async (req, res) => {
  try {
    const {
      hostId,
      hostName,
      hostEmail,
      _id,
      rating,
      reviewCount,
      ...studioData
    } = req.body;

    const newStudio = {
      ...studioData,
      hostId: req.user.id,
      hostName: req.user.name,
      hostEmail: req.user.email.trim().toLowerCase(),
      createdAt: new Date(),
    };

    const result = await studios.insertOne(newStudio);

    res.status(201).send({
      message: "Studio published successfully",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Failed to add studio",
    });
  }
});

app.get("/studios/:id", async (req, res) => {
  try {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: "Invalid Studio ID",
      });
    }

    const result = await studios.findOne({
      _id: new ObjectId(id),
    });

    if (!result) {
      return res.status(404).send({
        message: "Studio not found",
      });
    }

    const { rating, reviewCount } = await getStudioRating(id);

    res.send({
      ...result,
      rating,
      reviewCount,
    });
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Failed to fetch studio",
    });
  }
});

app.get("/studios/:id/reviews", async (req, res) => {
  try {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: "Invalid Studio ID",
      });
    }

    const studio = await studios.findOne({
      _id: new ObjectId(id),
    });

    if (!studio) {
      return res.status(404).send({
        message: "Studio not found",
      });
    }

    const studioReviews = await reviews
      .find({ studioId: id })
      .sort({ createdAt: -1 })
      .toArray();

    res.send(studioReviews);
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Failed to fetch reviews",
    });
  }
});

app.post("/studios/:id/reviews", requireAuth, async (req, res) => {
  try {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: "Invalid Studio ID",
      });
    }

    const studio = await studios.findOne({
      _id: new ObjectId(id),
    });

    if (!studio) {
      return res.status(404).send({
        message: "Studio not found",
      });
    }

    const { bookingId, rating, comment } = req.body;

    if (
      typeof bookingId !== "string" ||
      !ObjectId.isValid(bookingId)
    ) {
      return res.status(400).send({
        message: "Invalid Booking ID",
      });
    }

    if (
      typeof rating !== "number" ||
      !Number.isInteger(rating) ||
      rating < 1 ||
      rating > 5
    ) {
      return res.status(400).send({
        message: "Rating must be between 1 and 5",
      });
    }

    if (
      typeof comment !== "string" ||
      comment.trim().length < 10 ||
      comment.trim().length > 1000
    ) {
      return res.status(400).send({
        message: "Review must be between 10 and 1000 characters",
      });
    }

    const booking = await bookings.findOne({
      _id: new ObjectId(bookingId),
      ...getCustomerBookingQuery(req.user),
      studioId: id,
    });

    if (!booking) {
      return res.status(403).send({
        message: "You can only review your own booking",
      });
    }

    if (
      typeof booking.status !== "string" ||
      booking.status.toLowerCase() !== "completed"
    ) {
      return res.status(400).send({
        message: "You can only review completed bookings",
      });
    }

    const newReview = {
      studioId: id,
      bookingId,
      userId: req.user.id,
      userName: req.user.name,
      userEmail: req.user.email.trim().toLowerCase(),
      rating,
      comment: comment.trim(),
      createdAt: new Date(),
    };

    const result = await reviews.insertOne(newReview);

    const { rating: averageRating, reviewCount } =
      await getStudioRating(id);

    res.status(201).send({
      message: "Review submitted successfully",
      insertedId: result.insertedId,
      rating: averageRating,
      reviewCount,
    });
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Failed to submit review",
    });
  }
});

app.patch("/studios/:id", requireAuth, async (req, res) => {
  try {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: "Invalid Studio ID",
      });
    }

    const {
      hostEmail,
      hostId,
      hostName,
      _id,
      rating,
      reviewCount,
      ...updatedStudio
    } = req.body;

    const filter = {
      _id: new ObjectId(id),
      ...getUserOwnershipQuery(req.user),
    };

    const existingStudio = await studios.findOne(filter);

    if (!existingStudio) {
      return res.status(403).send({
        message: "You cannot update this studio",
      });
    }

    const result = await studios.updateOne(filter, {
      $set: updatedStudio,
    });

    res.send(result);
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Failed to update studio",
    });
  }
});

app.delete("/studios/:id", requireAuth, async (req, res) => {
  try {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: "Invalid Studio ID",
      });
    }

    const filter = {
      _id: new ObjectId(id),
      ...getUserOwnershipQuery(req.user),
    };

    const existingStudio = await studios.findOne(filter);

    if (!existingStudio) {
      return res.status(403).send({
        message: "You cannot delete this studio",
      });
    }

    const result = await studios.deleteOne(filter);

    res.send(result);
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Failed to delete studio",
    });
  }
});

app.get("/bookings/availability", requireAuth, async (req, res) => {
  try {
    const { studioId, bookingDate, startTime, endTime } = req.query;

    if (
      typeof studioId !== "string" ||
      typeof bookingDate !== "string" ||
      typeof startTime !== "string" ||
      typeof endTime !== "string"
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

    const studio = await studios.findOne({
      _id: new ObjectId(studioId),
    });

    if (!studio) {
      return res.status(404).send({
        message: "Studio not found",
      });
    }

    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

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

    if (
      !timePattern.test(startTime) ||
      !timePattern.test(endTime) ||
      startTime >= endTime
    ) {
      return res.status(400).send({
        message: "Invalid booking time",
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
      return res.status(200).send({
        available: false,
        message:
          "This time slot is already booked. Please select another time.",
      });
    }

    return res.status(200).send({
      available: true,
      message: "This time slot is available.",
    });
  } catch (error) {
    console.error("Availability check error:", error);

    return res.status(500).send({
      message: "Unable to check studio availability",
    });
  }
});

app.get("/bookings", requireAuth, async (req, res) => {
  try {
    const customerBookings = await bookings
      .find(getCustomerBookingQuery(req.user))
      .sort({ createdAt: -1 })
      .toArray();

    res.send(customerBookings);
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Failed to fetch bookings",
    });
  }
});

app.get("/host-bookings", requireAuth, async (req, res) => {
  try {
    const studioIds = await getHostBookingQuery(req.user);

    if (studioIds.length === 0) {
      return res.send([]);
    }

    const hostBookings = await bookings
      .find({
        studioId: { $in: studioIds },
      })
      .sort({ createdAt: -1 })
      .toArray();

    res.send(hostBookings);
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Failed to fetch host bookings",
    });
  }
});

app.patch("/bookings/:id/confirm", requireAuth, async (req, res) => {
  try {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: "Invalid Booking ID",
      });
    }

    const bookingId = new ObjectId(id);

    const existingBooking = await bookings.findOne({
      _id: bookingId,
    });

    if (!existingBooking) {
      return res.status(404).send({
        message: "Booking not found",
      });
    }

    const studioId = String(existingBooking.studioId || "");

    if (!ObjectId.isValid(studioId)) {
      return res.status(400).send({
        message: "Invalid Studio ID",
      });
    }

    const studio = await studios.findOne({
      _id: new ObjectId(studioId),
      ...getUserOwnershipQuery(req.user),
    });

    if (!studio) {
      return res.status(403).send({
        message: "You cannot confirm this booking",
      });
    }

    if (
      typeof existingBooking.status !== "string" ||
      existingBooking.status.toLowerCase() !== "pending"
    ) {
      return res.status(400).send({
        message: "Only pending bookings can be confirmed",
      });
    }

    const overlappingBooking = await bookings.findOne({
      _id: { $ne: bookingId },
      studioId,
      bookingDate: existingBooking.bookingDate,
      status: "Confirmed",
      startTime: { $lt: existingBooking.endTime },
      endTime: { $gt: existingBooking.startTime },
    });

    if (overlappingBooking) {
      return res.status(409).send({
        message: "This studio is already booked for this time",
      });
    }

    const result = await bookings.updateOne(
      {
        _id: bookingId,
        status: existingBooking.status,
      },
      {
        $set: {
          status: "Confirmed",
          confirmedAt: new Date(),
          confirmedBy: req.user.id,
        },
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(409).send({
        message: "Booking status has already changed",
      });
    }

    res.send({
      message: "Booking confirmed successfully",
    });
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Failed to confirm booking",
    });
  }
});

app.patch("/bookings/:id/reject", requireAuth, async (req, res) => {
  try {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: "Invalid Booking ID",
      });
    }

    const bookingId = new ObjectId(id);

    const existingBooking = await bookings.findOne({
      _id: bookingId,
    });

    if (!existingBooking) {
      return res.status(404).send({
        message: "Booking not found",
      });
    }

    const studioId = String(existingBooking.studioId || "");

    if (!ObjectId.isValid(studioId)) {
      return res.status(400).send({
        message: "Invalid Studio ID",
      });
    }

    const studio = await studios.findOne({
      _id: new ObjectId(studioId),
      ...getUserOwnershipQuery(req.user),
    });

    if (!studio) {
      return res.status(403).send({
        message: "You cannot reject this booking",
      });
    }

    if (
      typeof existingBooking.status !== "string" ||
      existingBooking.status.toLowerCase() !== "pending"
    ) {
      return res.status(400).send({
        message: "Only pending bookings can be rejected",
      });
    }

    const result = await bookings.updateOne(
      {
        _id: bookingId,
        status: existingBooking.status,
      },
      {
        $set: {
          status: "Rejected",
          rejectedAt: new Date(),
          rejectedBy: req.user.id,
        },
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(409).send({
        message: "Booking status has already changed",
      });
    }

    res.send({
      message: "Booking rejected successfully",
    });
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Failed to reject booking",
    });
  }
});

app.patch("/bookings/:id/complete", requireAuth, async (req, res) => {
  try {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: "Invalid Booking ID",
      });
    }

    const bookingId = new ObjectId(id);

    const existingBooking = await bookings.findOne({
      _id: bookingId,
    });

    if (!existingBooking) {
      return res.status(404).send({
        message: "Booking not found",
      });
    }

    const studioId = String(existingBooking.studioId || "");

    if (!ObjectId.isValid(studioId)) {
      return res.status(400).send({
        message: "Invalid Studio ID",
      });
    }

    const studio = await studios.findOne({
      _id: new ObjectId(studioId),
      ...getUserOwnershipQuery(req.user),
    });

    if (!studio) {
      return res.status(403).send({
        message: "You cannot complete this booking",
      });
    }

    if (
      typeof existingBooking.status !== "string" ||
      existingBooking.status.toLowerCase() !== "confirmed"
    ) {
      return res.status(400).send({
        message: "Only confirmed bookings can be completed",
      });
    }

    const result = await bookings.updateOne(
      {
        _id: bookingId,
        status: existingBooking.status,
      },
      {
        $set: {
          status: "Completed",
          completedAt: new Date(),
          completedBy: req.user.id,
        },
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(409).send({
        message: "Booking status has already changed",
      });
    }

    res.send({
      message: "Booking completed successfully",
    });
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Failed to complete booking",
    });
  }
});

app.patch("/bookings/:id/cancel", requireAuth, async (req, res) => {
  try {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: "Invalid Booking ID",
      });
    }

    const filter = {
      _id: new ObjectId(id),
      ...getCustomerBookingQuery(req.user),
    };

    const existingBooking = await bookings.findOne(filter);

    if (!existingBooking) {
      return res.status(404).send({
        message: "Booking not found",
      });
    }

    if (
      typeof existingBooking.status !== "string" ||
      existingBooking.status.toLowerCase() !== "pending"
    ) {
      return res.status(400).send({
        message: "Only pending bookings can be cancelled",
      });
    }

    const result = await bookings.updateOne(
      {
        ...filter,
        status: existingBooking.status,
      },
      {
        $set: {
          status: "Cancelled",
          cancelledAt: new Date(),
        },
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(400).send({
        message: "Booking could not be cancelled",
      });
    }

    res.send({
      message: "Booking cancelled successfully",
    });
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Failed to cancel booking",
    });
  }
});

app.post("/bookings", requireAuth, async (req, res) => {
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
      bookingDate,
      startTime,
      endTime,
    } = newBooking;

    if (
      typeof studioId !== "string" ||
      typeof bookingDate !== "string" ||
      typeof startTime !== "string" ||
      typeof endTime !== "string"
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

    const studio = await studios.findOne({
      _id: new ObjectId(studioId),
    });

    if (!studio) {
      return res.status(404).send({
        message: "Studio not found",
      });
    }

    const hourlyRate = Number(studio.hourlyRate);

    if (
      !Number.isFinite(hourlyRate) ||
      hourlyRate <= 0
    ) {
      return res.status(400).send({
        message: "Invalid studio hourly rate",
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

    const [startHour, startMinute] = startTime
      .split(":")
      .map(Number);

    const [endHour, endMinute] = endTime
      .split(":")
      .map(Number);

    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;

    const durationHours = (endMinutes - startMinutes) / 60;

    if (
      !Number.isInteger(durationHours) ||
      durationHours < 1 ||
      durationHours > 6
    ) {
      return res.status(400).send({
        message: "Booking duration must be between 1 and 6 hours",
      });
    }

    const totalPrice = hourlyRate * durationHours;

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
      customerId: req.user.id,
      customerEmail: req.user.email.trim().toLowerCase(),
      customerName: req.user.name,
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

app.use((error, req, res, next) => {
  console.error(error);

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).send({
    message: "Internal server error",
  });
});

export default app;

if (!process.env.VERCEL) {
  connectToDatabase()
    .then(() => {
      app.listen(port, () => {
        console.log(`StudioSpace Server is running on port ${port}`);
      });
    })
    .catch(console.error);
}