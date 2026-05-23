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

// Static Files
app.use(express.static("public"));

// Google OAuth
const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

// Home Page
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

// Google Login
app.get("/auth/google", (req, res) => {

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",

    scope: [
      "https://www.googleapis.com/auth/calendar"
    ],

  });

  res.redirect(url);

});

// Google Callback
app.get("/auth/google/callback", async (req, res) => {

  const code = req.query.code;

  const { tokens } = await oauth2Client.getToken(code);

  oauth2Client.setCredentials(tokens);

  res.send(`
    
    <h2>
      Google Calendar Connected Successfully!
    </h2>

    <a href="/">
      Go To Booking Form
    </a>

  `);

});

// Create Booking
app.get("/book-room", async (req, res) => {

  const { room, date, start, end } = req.query;

  await db.read();

  // Conflict Detection
  const existingBooking = db.data.bookings.find((booking) => {

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
        Room already booked for this time!
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

    summary: `Room Booking - ${room}`,

    location: room,

    description: "Room booked successfully",

    start: {
      dateTime: startDateTime,
      timeZone: "Asia/Kolkata",
    },

    end: {
      dateTime: endDateTime,
      timeZone: "Asia/Kolkata",
    },

  };

  try {

    await calendar.events.insert({
      calendarId: "primary",
      resource: event,
    });

    // Save in DB
    db.data.bookings.push({
      room,
      date,
      start,
      end,
    });

    await db.write();

    res.send(`

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

    `);

  } catch (error) {

    console.log(error);

    res.send("Error booking room");

  }

});

// Show All Bookings
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
          border-collapse: collapse;
          width: 100%;
          background: white;
        }

        th, td {
          padding: 12px;
          border: 1px solid gray;
          text-align: center;
        }

        a {
          text-decoration: none;
          color: blue;
        }

      </style>

    </head>

    <body>

      <h1>
        All Room Bookings
      </h1>

      <a href="/">
        Back To Booking Form
      </a>

      <br><br>

      <table>

        <tr>

          <th>Room</th>
          <th>Date</th>
          <th>Start</th>
          <th>End</th>
          <th>Action</th>

        </tr>

  `;

  db.data.bookings.forEach((booking, index) => {

    html += `

      <tr>

        <td>${booking.room}</td>

        <td>${booking.date}</td>

        <td>${booking.start}</td>

        <td>${booking.end}</td>

        <td>

          <a href="/delete-booking/${index}">
            Cancel
          </a>

        </td>

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

// Delete Booking
app.get("/delete-booking/:id", async (req, res) => {

  const id = req.params.id;

  await db.read();

  db.data.bookings.splice(id, 1);

  await db.write();

  res.redirect("/bookings");

});

// Server
app.listen(3000, () => {

  console.log("Server running on port 3000");

});
