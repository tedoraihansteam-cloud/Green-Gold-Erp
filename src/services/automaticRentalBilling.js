const { query } = require('../config/db');
const { accrueRentForCompany,backfillUnbilledRentForCompany } = require('../controllers/batchController');

let running=false;
async function runAutomaticRentalBilling(){if(running)return;running=true;try{const {rows}=await query(`SELECT id FROM companies`);for(const company of rows){await backfillUnbilledRentForCompany(company.id);await accrueRentForCompany(company.id);}}catch(error){console.error('Automatic rental billing failed:',error.message);}finally{running=false;}}
function startAutomaticRentalBilling(){runAutomaticRentalBilling();const timer=setInterval(runAutomaticRentalBilling,60*60*1000);timer.unref();}
module.exports={startAutomaticRentalBilling,runAutomaticRentalBilling};
