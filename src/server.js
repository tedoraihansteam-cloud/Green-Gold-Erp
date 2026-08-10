require('dotenv').config();
const app = require('./app');

const PORT = process.env.PORT || 4000;
const { startAutomaticRentalBilling } = require('./services/automaticRentalBilling');

app.listen(PORT, () => {
    console.log(`Green Gold ERP API listening on port ${PORT}`);
    startAutomaticRentalBilling();
});
