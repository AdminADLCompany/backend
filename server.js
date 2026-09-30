const path = require('path');
const dotenv = require('dotenv');

// Config must load before anything reads process.env
dotenv.config({ path: path.join(__dirname, 'config', 'config.env') });

const app = require('./app');
const connectDatabase = require('./config/database');

const PORT = Number(process.env.PORT) || 5000;
const HOST = process.env.HOST || '127.0.0.1';

connectDatabase();

// Start server
app.listen(PORT, HOST, () => {
    console.log(`Server is started on http://${HOST}:${PORT} in ${process.env.NODE_ENV} mode`);
});

process.on('uncaughtException', err => {
    console.log(`ERROR: ${err.message}`);
    console.log('Shutting down due to uncaught exception')
    process.exit(1)
})
