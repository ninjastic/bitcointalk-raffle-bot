import mongoose from "mongoose";
import { settings } from "../utils";

mongoose.connect(settings.mongoUrl);
