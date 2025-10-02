// Importing the library
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

// Using express
const app = express();

const errorHandler = require('./middleware/error');

// Use CORS middleware
app.use(cors({
    origin: ['http://localhost:3000', 'https://adlcompany.web.app'], // Add all your frontend URLs
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));

// Preflight request handling
// app.options('*', cors());

// Using middleware
app.use(express.json());
app.use(cookieParser());

// Importing routes
const user = require('./routes/user');
const product = require('./routes/product');
const department = require('./routes/department');
const process = require('./routes/process');

// Using routes
app.use('/api/v1/user', user);
app.use('/api/v1/product', product);
app.use('/api/v1/department', department);
app.use('/api/v1/process', process);

app.get('/', (req, res) => {
    res.send('Hello World!');
});


app.use(errorHandler);

module.exports = app;