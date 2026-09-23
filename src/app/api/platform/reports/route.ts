import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { loadWorkspace } from "@/production/server/workspace";
import { errorResponse, HttpError } from "@/production/server/http";
import { analytics } from "@/production/analytics";
import { csvText } from "@/production/csv";
import {
  demoOperation,
  requireDemoSession,
} from "@/production/server/demo-session";
export async function GET(request: Request) {
  try {
    const headers = new Headers(request.headers);
    if (new URL(request.url).searchParams.get("demo") === "1")
      headers.set("x-prodplan-demo", "1");
    if (headers.get("x-prodplan-demo") === "1")
      await demoOperation(await requireDemoSession(headers), "report");
    const query = new URL(request.url).searchParams,
      format = query.get("format") ?? "csv",
      data = await loadWorkspace(headers, query.get("tenantId") ?? ""),
      stats = analytics(data);
    if (!["csv", "schedule", "pdf"].includes(format))
      throw new HttpError(400, "Choose CSV, schedule CSV or PDF.");
    if (format !== "pdf") {
      const rows =
        format === "csv"
          ? [
              [
                "Order",
                "Customer",
                "Product",
                "Quantity",
                "Priority",
                "Deadline",
                "Forecast completion",
                "Production status",
                "Completed at",
                "Delivered at",
              ],
              ...data.orders.map((o) => {
                const p = data.plan?.orders.find((p) => p.orderId === o.id);
                return [
                  o.number,
                  o.customer,
                  o.productName,
                  o.quantity,
                  o.priority,
                  o.deadline,
                  p?.finish ?? "",
                  p?.status ?? "queued",
                  o.completedAt ?? "",
                  o.deliveredAt ?? "",
                ];
              }),
            ]
          : [
              [
                "Order",
                "Stage",
                "Work center",
                "Date",
                "Start minute",
                "Duration minutes",
                "Locked",
              ],
              ...(data.plan?.allocations ?? []).map((a) => {
                const o = data.orders.find((o) => o.id === a.orderId)!;
                return [
                  o.number,
                  o.stages.find((s) => s.id === a.stageId)?.name,
                  data.machines.find((m) => m.id === a.machineId)?.name,
                  a.date,
                  a.startMinute,
                  a.minutes,
                  a.locked ? "Yes" : "No",
                ];
              }),
            ];
      return new Response(csvText(rows), {
        headers: {
          "Content-Type": "text/csv;charset=utf-8",
          "Content-Disposition": `attachment; filename="prodplan-${format}.csv"`,
        },
      });
    }
    const pdf = await PDFDocument.create(),
      font = await pdf.embedFont(StandardFonts.Helvetica),
      bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    let page = pdf.addPage([595.28, 841.89]),
      y = 792;
    const clean = (text: string) => text.replace(/[^\x20-\x7e\xa0-\xff]/g, "?");
    function line(text: string, size = 11, strong = false) {
      const face = strong ? bold : font,
        words = clean(text).split(/\s+/);
      let current = "";
      for (const word of words) {
        if (
          face.widthOfTextAtSize(current + " " + word, size) > 495 &&
          current
        ) {
          draw(current, size, face);
          current = word;
        } else current += (current ? " " : "") + word;
      }
      draw(current, size, face);
    }
    function draw(text: string, size: number, face: typeof font) {
      if (y < 60) {
        page = pdf.addPage([595.28, 841.89]);
        y = 792;
      }
      page.drawText(text, {
        x: 50,
        y,
        size,
        font: face,
        color: rgb(0.13, 0.17, 0.24),
        maxWidth: 495,
      });
      y -= size + 7;
    }
    line("PRODPLAN / PRODUCTION REPORT", 10, true);
    y -= 10;
    line(data.tenant.name, 22, true);
    line(
      `Generated ${new Date().toISOString()} | Plant time zone: ${data.tenant.timeZone}`,
      9,
    );
    y -= 12;
    line(
      `Active orders: ${stats.active} | Completed orders: ${stats.completed} | Completed units: ${stats.throughput}`,
      11,
      true,
    );
    line(
      `Confirmed deliveries: ${stats.delivered} | On time: ${stats.onTimePercent === null ? "No deliveries" : stats.onTimePercent + "%"} | Delivery overdue: ${stats.overdue}`,
    );
    line(
      `Recorded productive time: ${(stats.productiveMinutes / 60).toFixed(1)} hours. Holds excluded.`,
    );
    y -= 12;
    line("PLANNED UTILIZATION", 13, true);
    for (const m of stats.utilization)
      line(
        `${m.name}: ${m.percent}% (${(m.planned / 60).toFixed(1)} / ${(m.available / 60).toFixed(1)} available hours)`,
      );
    y -= 12;
    line("ORDERS", 13, true);
    for (const o of data.orders) {
      const p = data.plan?.orders.find((r) => r.orderId === o.id);
      line(`${o.number} | ${o.productName} | ${o.quantity} units`, 11, true);
      line(`${o.customer} | Priority: ${o.priority} | Due: ${o.deadline}`, 10);
      line(
        `Forecast: ${p?.finish ?? "Unplanned"} | Status: ${p?.status ?? "queued"} | Delivered: ${o.deliveredAt ?? "Not confirmed"}`,
        10,
      );
      for (const r of p?.risks ?? []) line(r.message, 9);
      y -= 8;
    }
    const pages = pdf.getPages();
    pages.forEach((p, i) =>
      p.drawText(`ProdPlan | ${i + 1} / ${pages.length}`, {
        x: 50,
        y: 30,
        size: 9,
        font,
        color: rgb(0.4, 0.45, 0.5),
      }),
    );
    return new Response(new Uint8Array(await pdf.save()), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition":
          "attachment; filename=prodplan-production-report.pdf",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
