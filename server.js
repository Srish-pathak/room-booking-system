require("dotenv").config();

const express = require("express");
const { google } = require("googleapis");

const { Low } = require("lowdb");
const { JSONFile } = require("lowdb/node");

const app = express();

const adapter = new JSONFile("db.json");

const db = new Low(adapter, {
  bookings: [],
});

// STATIC FILES
app.use(express.static("public"));

// GOOGLE OAUTH

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

let isAuthenticated = false;

// HOME PAGE

app.get("/", (req, res) => {

  res.sendFile(__dirname + "/public/index.html");

});

// GOOGLE LOGIN

app.get("/auth/google", (req, res) => {

  const url = oauth2Client.generateAuthUrl({

    access_type: "offline",

    scope: [
      "https://www.googleapis.com/auth/calendar"
    ],

    prompt: "consent"

  });

  res.redirect(url);

});

// GOOGLE CALLBACK

app.get("/auth/google/callback", async (req, res) => {

  try {

    const code = req.query.code;

    const { tokens } =
      await oauth2Client.getToken(code);

    oauth2Client.setCredentials(tokens);

    isAuthenticated = true;

    console.log("Google Calendar Connected");

    res.send(`

      <h2>
        Google Calendar Connected Successfully
      </h2>

      <a href="/">
        Go Back
      </a>

    `);

  } catch (error) {

    console.log(error);

    res.send("Google Login Failed");

  }

});

// CHECK AVAILABILITY

app.get("/check-availability", async (req, res) => {

  const { room, date, start, end } = req.query;

  await db.read();

  const existingBooking =
    db.data.bookings.find((booking) => {

      return (

        booking.room === room &&
        booking.date === date &&

        start < booking.end &&
        end > booking.start

      );

    });

  if (existingBooking) {

    return res.send("Busy");

  }

  res.send("Available");

});

// BOOK ROOM

app.get("/book-room", async (req, res) => {

  const {
    room,
    date,
    start,
    end,
    title,
    attendee
  } = req.query;

  if (!isAuthenticated) {

    return res.send(`

      <h2>
        Please Login With Google First
      </h2>

      <a href="/auth/google">
        Connect Google Calendar
      </a>

    `);

  }

  await db.read();

  const existingBooking =
    db.data.bookings.find((booking) => {

      return (

        booking.room === room &&
        booking.date === date &&

        start < booking.end &&
        end > booking.start

      );

    });

  if (existingBooking) {

    return res.send(`

      <h2>
        Room Already Booked
      </h2>

      <a href="/">
        Go Back
      </a>

    `);

  }

  const calendar = google.calendar({

    version: "v3",
    auth: oauth2Client,

  });

  const startDateTime =
    `${date}T${start}:00+05:30`;

  const endDateTime =
    `${date}T${end}:00+05:30`;

  const event = {

    summary: title || `Room Booking - ${room}`,

    location: room,

    description:
      "Room booked from IIT BHU Scheduler",

    start: {

      dateTime: startDateTime,
      timeZone: "Asia/Kolkata",

    },

    end: {

      dateTime: endDateTime,
      timeZone: "Asia/Kolkata",

    },

    attendees: attendee
      ? [{ email: attendee }]
      : [],

  };

  try {

    await calendar.events.insert({

      calendarId: "primary",
      resource: event,

    });

    db.data.bookings.push({

      room,
      date,
      start,
      end,
      title,
      attendee

    });

    await db.write();

    res.send(`

      <h2>
        Room Booked Successfully
      </h2>

      <a href="/">
        Book Another Room
      </a>

      <br><br>

      <a href="/bookings">
        View All Bookings
      </a>

    `);

  } catch (error) {

    console.log(error);

    res.send("Error booking room");

  }

});

// REAL BOOKINGS API

app.get("/api/bookings", async (req, res) => {

  await db.read();

  res.json(db.data.bookings);

});

// SHOW BOOKINGS PAGE

app.get("/bookings", async (req, res) => {

  await db.read();

  let html = `

    <html>

    <head>

      <title>
        All Bookings
      </title>

      <style>

        body {

          font-family: Arial;
          padding: 40px;
          background: #0f172a;
          color: white;

        }

        table {

          width: 100%;
          border-collapse: collapse;
          background: white;
          color: black;

        }

        th, td {

          border: 1px solid gray;
          padding: 12px;
          text-align: center;

        }

        a {

          color: cyan;
          text-decoration: none;

        }

      </style>

    </head>

    <body>

      <h1>
        All Room Bookings
      </h1>

      <a href="/">
        Back
      </a>

      <br><br>

      <table>

        <tr>

          <th>Title</th>
          <th>Room</th>
          <th>Date</th>
          <th>Start</th>
          <th>End</th>

        </tr>

  `;

  db.data.bookings.forEach((booking) => {

    html += `

      <tr>

        <td>${booking.title}</td>
        <td>${booking.room}</td>
        <td>${booking.date}</td>
        <td>${booking.start}</td>
        <td>${booking.end}</td>

      </tr>

    `;

  });

  html += `

      </table>

    </body>

    </html>

  `;

  res.send(html);

});

// SERVER

app.listen(3000, () => {

  console.log("Server running on port 3000");

});
