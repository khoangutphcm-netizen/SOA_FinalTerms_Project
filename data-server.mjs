import { startDataService } from "./internal-services.mjs";

const service = process.argv[2];
if (!["IDENTITY", "COMMUNITY"].includes(service))
  throw new Error("Unknown data service");
startDataService(service);
