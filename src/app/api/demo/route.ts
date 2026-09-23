import { z } from "zod";
import { openDemo } from "@/production/server/demo";
import { getRuntime } from "@/production/server/runtime";
import {
  errorResponse,
  HttpError,
  readJson,
  requireOrigin,
} from "@/production/server/http";
export async function POST(request: Request) {
  try {
    await requireOrigin(request, getRuntime().BETTER_AUTH_URL!);
    const parsed = z
      .object({
        reset: z.boolean().optional(),
        timeZone: z
          .string()
          .max(80)
          .refine((s) => {
            try {
              new Intl.DateTimeFormat("en", { timeZone: s });
              return true;
            } catch {
              return false;
            }
          })
          .optional(),
      })
      .safeParse(await readJson(request));
    if (!parsed.success)
      throw new HttpError(400, "Choose a valid plant time zone.");
    return await openDemo(request, parsed.data);
  } catch (error) {
    return errorResponse(error);
  }
}
