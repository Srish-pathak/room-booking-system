require("dotenv").config();

const express = require("express");

const { google } = require("googleapis");

const { Low } = require("lowdb");

const { JSONFile } = require("lowdb/node");

const app = express();

// ==========================
// DATABASE SETUP
// ==========================

const adapter = new JSONFile("db.json");

const db = new Low(adapter, {
  bookings: [],
});

// ==========================
// STATIC FILES
// ==========================

app.use(express.static("public"));

// ==========================
// GOOGLE OAUTH
// ==========================

const oauth2Client =
  new google.auth.OAuth2(

    process.env.CLIENT_ID,

    process.env.CLIENT_SECRET,

    process.env.REDIRECT_URI

  );

// ==========================
// LOGIN FLAG
// ==========================

let isAuthenticated = false;

// ==========================
// HOME ROUTE
// ==========================

app.get("/", (req, res) => {

  res.sendFile(
    __dirname + "/public/index.html"
  );

});

// ==========================
// GOOGLE LOGIN
// ==========================

app.get("/auth/google", (req, res) => {

  const url =
    oauth2Client.generateAuthUrl({

      access_type: "offline",

      scope: [
        "https://www.googleapis.com/auth/calendar"
      ],

    });

  res.redirect(url);

});

// ==========================
// GOOGLE CALLBACK
// ==========================

app.get(
  "/auth/google/callback",

  async (req, res) => {

    try {

      const code =
        req.query.code;

      const { tokens } =
        await oauth2Client.getToken(code);

      oauth2Client.setCredentials(tokens);

      isAuthenticated = true;

      console.log(
        "Google Calendar Connected"
      );

      res.send(`

        <html>

        <body style="font-family: Arial; padding: 40px;">

          <h2>
            Google Calendar Connected Successfully!
          </h2>

          <a href="/">
            Go To Booking Form
          </a>

        </body>

        </html>

      `);

    } catch (error) {

      console.log(error);

      res.send(
        "Google Authentication Failed"
      );

    }

  }

);

// ==========================
// CHECK AVAILABILITY
// ==========================

app.get(
  "/check-availability",

  async (req, res) => {

    const {
      room,
      date,
      start,
      end
    } = req.query;

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

  }

);

// ==========================
// BOOK ROOM
// ==========================

app.get("/book-room", async (req, res) => {

  if (!isAuthenticated) {

    return res.send(`

      <html>

      <body style="font-family: Arial; padding: 40px;">

        <h2>
          Please Login With Google First
        </h2>

        <a href="/auth/google">
          Login With Google
        </a>

      </body>

      </html>

    `);

  }

  const {

    title,
    room,
    date,
    start,
    end,
    attendee

  } = req.query;

  await db.read();

  // ==========================
  // CONFLICT DETECTION
  // ==========================

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

      <html>

      <body style="font-family: Arial; padding: 40px;">

        <h2>
          Room already booked!
        </h2>

        <a href="/">
          Go Back
        </a>

      </body>

      </html>

    `);

  }

  // ==========================
  // GOOGLE CALENDAR
  // ==========================

  const calendar =
    google.calendar({

      version: "v3",
      auth: oauth2Client,

    });

  const startDateTime =
    `${date}T${start}:00+05:30`;

  const endDateTime =
    `${date}T${end}:00+05:30`;

  // ==========================
  // EVENT OBJECT
  // ==========================

  const event = {

    summary: title,

    location: room,

    description:
      "Room booked successfully",

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

    // ==========================
    // CREATE EVENT
    // ==========================

    await calendar.events.insert({

      calendarId: "primary",

      resource: event,

    });

    // ==========================
    // SAVE BOOKING
    // ==========================

    db.data.bookings.push({

      title,
      room,
      date,
      start,
      end,
      attendee,

    });

    await db.write();

    res.send(`

      <html>

      <body style="font-family: Arial; padding: 40px;">

        <h2>
          Room Booked Successfully!
        </h2>

        <a href="/">
          Book Another Room
        </a>

        <br><br>

        <a href="/bookings">
          View All Bookings
        </a>

      </body>

      </html>

    `);

  } catch (error) {

    console.log(error);

    res.send(`

      <html>

      <body style="font-family: Arial; padding: 40px;">

        <h2>
          Error Booking Room
        </h2>

        <a href="/">
          Go Back
        </a>

      </body>

      </html>

    `);

  }

});

// ==========================
// SHOW BOOKINGS
// ==========================

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
          background: #f4f4f4;

        }

        table {

          width: 100%;
          border-collapse: collapse;
          background: white;

        }

        th, td {

          padding: 12px;
          border: 1px solid gray;
          text-align: center;

        }

        th {

          background: #ddd;

        }

      </style>

    </head>

    <body>

      <h1>
        All Room Bookings
      </h1>

      <a href="/">
        Back To Home
      </a>

      <br><br>

      <table>

        <tr>

          <th>Title</th>
          <th>Room</th>
          <th>Date</th>
          <th>Start</th>
          <th>End</th>
          <th>Attendee</th>
          <th>Status</th>

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

        <td>${booking.attendee || "-"}</td>

        <td>Busy</td>

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

// ==========================
// START SERVER
// ==========================

app.listen(3000, () => {

  console.log(
    "Server running on port 3000"
  );

});
