import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();

// Login endpoints used by Convex Auth.
auth.addHttpRoutes(http);

export default http;
