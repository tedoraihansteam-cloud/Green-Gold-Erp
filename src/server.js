require('dotenv').config();

const app = require('./app');

const PORT = process.env.PORT || 8080;

const { startAutomaticRentalBilling } =
    require('./services/automaticRentalBilling');

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Green Gold ERP API listening on port ${PORT}`);
    startAutomaticRentalBilling();
});
