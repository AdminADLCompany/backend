const dotenv = require('dotenv');

const app = require('./app');
const PORT = process.env.PORT || 3008;
const connectDatabase = require('./config/database');


// Config
dotenv.config({ path: 'config/config.env' });

connectDatabase();

// Start server
app.listen(PORT, () => {
    console.log(`Server is started on port ${PORT} in ${process.env.NODE_ENV} mode`);
});

process.on('uncaughtException', err => {
    console.log(`ERROR: ${err.message}`);
    console.log('Shutting down due to uncaught exception')
    process.exit(1)
})
