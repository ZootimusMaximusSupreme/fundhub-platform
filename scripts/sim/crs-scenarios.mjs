// Fictional Experian Business cases for a simulated, saved personal CRS pull.
// These are fixture data only. No CRS client, database, or payment is called.

const CASES = Object.freeze({
  seasoned_clean: Object.freeze({
    name: "Cedar Mesa Consulting LLC", state: "AZ", naics: "541611",
    street: "100 Simulation Way", city: "Phoenix", postalCode: "85004", einLast4: "0001",
    ageMonths: 42, score: 84, fsr: 67, balance: 1200, highCredit: 12000,
    dbt: 0, active: true
  }),
  young_clean: Object.freeze({
    name: "Bright Mesa Marketing LLC", state: "AZ", naics: "541613",
    street: "200 Simulation Way", city: "Mesa", postalCode: "85201", einLast4: "0002",
    ageMonths: 8, score: 74, fsr: 53, balance: 3500, highCredit: 10000,
    dbt: 4, active: true
  }),
  lien_stressed: Object.freeze({
    name: "Desert Trade Services LLC", state: "NV", naics: "541611",
    street: "300 Simulation Way", city: "Las Vegas", postalCode: "89101", einLast4: "0003",
    ageMonths: 31, score: 38, fsr: 24, balance: 8700, highCredit: 10000,
    dbt: 48, active: true, taxLien: true, ucc: true
  }),
  inactive: Object.freeze({
    name: "Copper Trail Systems LLC", state: "TX", naics: "541000",
    street: "400 Simulation Way", city: "Austin", postalCode: "78701", einLast4: "0004",
    ageMonths: 26, score: 66, fsr: 42, balance: 2000, highCredit: 10000,
    dbt: 0, active: false
  })
});

export const BUSINESS_SCENARIOS = Object.freeze({
  seasoned_clean: ["seasoned_clean"],
  young_clean: ["young_clean"],
  lien_stressed: ["lien_stressed"],
  inactive: ["inactive"],
  two_clean: ["seasoned_clean", "young_clean"],
  mixed: ["seasoned_clean", "lien_stressed"]
});

function monthsBefore(asOf, months) {
  const day = new Date(`${String(asOf).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(day.getTime())) throw new Error("asOf must be a date");
  day.setUTCDate(1);
  day.setUTCMonth(day.getUTCMonth() - months);
  return day.toISOString().slice(0, 10);
}

export function buildBusinessScenario(key, { asOf = new Date().toISOString() } = {}) {
  const ids = BUSINESS_SCENARIOS[key];
  if (!ids) throw new Error(`unknown business scenario ${key}`);
  const businesses = [];
  const businessReports = [];
  for (const id of ids) {
    const c = CASES[id];
    const incorporatedDate = monthsBefore(asOf, c.ageMonths);
    businesses.push({
      name: c.name,
      age_months: c.ageMonths,
      entity_data: {
        source: "simulated_crs", state: c.state, naics: c.naics,
        address_line1: c.street, city: c.city, postal_code: c.postalCode,
        ein_last4: c.einLast4,
        incorporated_date: incorporatedDate.slice(0, 7)
      }
    });
    businessReports.push({
      name: c.name, state: c.state, ageMonths: c.ageMonths, bin: `SIM-${id}`,
      report: {
        simulated: true,
        data: {
          businessHeader: {
            businessName: c.name, bin: `SIM-${id}`,
            address: { addressLine1: c.street, city: c.city, state: c.state, postalCode: c.postalCode }
          },
          corporateRegistration: { incorporatedDate, statusFlag: { code: c.active ? "A" : "I" } },
          businessFacts: { businessType: "LLC", stateOfIncorporation: c.state, naicsCode: c.naics },
          scoreInformation: {
            commercialScore: { score: c.score, recommendedCreditLimitAmount: c.highCredit },
            fsrScore: { score: c.fsr }
          },
          expandedCreditSummary: {
            currentDbt: c.dbt,
            bankruptcyIndicator: false, judgmentIndicator: false, taxLienIndicator: c.taxLien === true,
            currentTotalAccountBalance: { amount: c.balance },
            highestCreditAmount: { amount: c.highCredit }
          },
          commercialFraudShieldSummary: {
            ofacMatchWarning: { code: 1 }, activeBusinessIndicator: c.active,
            nameAddressVerificationIndicator: true
          },
          uccFilingsDetail: c.ucc ? [{ filingNumber: `SIM-UCC-${id}` }] : []
        }
      }
    });
  }
  return { businesses, businessReports };
}
