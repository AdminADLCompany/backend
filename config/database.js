const mongoose = require('mongoose')

const connectDatabase = () => {
    const uri = process.env.DB_LOCAL_URI;    

    mongoose.connect(uri, { 
        family: 4
    }).then(con => {
        console.log(`mongoDB Database connected with Host: ${con.connection.host}`)
    }).catch(err => {
        console.log(`Error connecting the database: ${err}`)
        process.exit(1);
    })
}

module.exports = connectDatabase;