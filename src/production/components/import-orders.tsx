"use client";
import { useState } from "react";
import { FormDialog, Field } from "./forms";
import { parseCsv, csvText } from "../csv";
import { orderSchema, type Action } from "../validation";
import { addDays, localDay } from "../dates";
import type { Workspace } from "../types";
export function download(
  name: string,
  content: string,
  type = "text/csv;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([content], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function ImportOrders({
  data,
  save,
  close,
}: {
  data: Workspace;
  save: (action: Action) => Promise<void>;
  close: () => void;
}) {
  const [rows, setRows] = useState<
      Array<{
        number: string;
        customer: string;
        productId: string;
        quantity: number;
        priority: "urgent" | "high" | "normal" | "low";
        deadline: string;
      }>
    >([]),
    [error, setError] = useState("");
  const headers = [
    "number",
    "customer",
    "product_sku",
    "quantity",
    "priority",
    "deadline",
  ];
  return (
    <FormDialog
      title="Import orders"
      close={close}
      submit={async () => {
        if (!rows.length) throw new Error("Choose a valid CSV file first.");
        await save({ action: "order.import", rows });
      }}
    >
      <p className="muted">
        Import up to 200 orders together. Every row is checked before anything
        is saved. Dates use YYYY-MM-DD.
      </p>
      <button
        type="button"
        className="button"
        onClick={() =>
          download(
            "prodplan-order-template.csv",
            csvText([
              headers,
              [
                "IMPORT-001",
                "Sample customer",
                data.products[0]?.sku ?? "YOUR-SKU",
                100,
                "normal",
                addDays(localDay(data.tenant.timeZone), 7),
              ],
            ]),
          )
        }
      >
        Download CSV template
      </button>
      <Field label="Order CSV">
        <input
          type="file"
          accept=".csv,text/csv"
          required
          onChange={async (e) => {
            setRows([]);
            setError("");
            try {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 2_000_000)
                throw new Error("Choose a file smaller than 2 MB.");
              const [head, ...body] = parseCsv(await file.text());
              if (
                !head ||
                headers.some((h, i) => head[i]?.trim().toLowerCase() !== h) ||
                head.length !== headers.length
              )
                throw new Error(
                  "Use the column names and order from the CSV template.",
                );
              if (!body.length || body.length > 200)
                throw new Error("Include between 1 and 200 orders.");
              const next = body.map((cells, i) => {
                if (cells.length !== 6)
                  throw new Error(`Row ${i + 2}: expected six columns.`);
                const product = data.products.find(
                  (p) => p.sku.toLowerCase() === cells[2].trim().toLowerCase(),
                );
                if (!product)
                  throw new Error(`Row ${i + 2}: product SKU was not found.`);
                const result = orderSchema
                  .omit({ id: true })
                  .safeParse({
                    number: cells[0],
                    customer: cells[1],
                    productId: product.id,
                    quantity: Number(cells[3]),
                    priority: cells[4].trim().toLowerCase(),
                    deadline: cells[5].trim(),
                  });
                if (!result.success)
                  throw new Error(
                    `Row ${i + 2}: ${result.error.issues[0].message}`,
                  );
                return result.data;
              });
              const numbers = next.map((r) => r.number.toLowerCase());
              if (
                new Set(numbers).size !== numbers.length ||
                data.orders.some((o) =>
                  numbers.includes(o.number.toLowerCase()),
                )
              )
                throw new Error(
                  "Order references must be unique and must not already exist.",
                );
              setRows(next);
            } catch (error) {
              setError(
                error instanceof Error
                  ? error.message
                  : "Could not read the CSV.",
              );
            }
          }}
        />
      </Field>
      {error && (
        <p className="p-error" role="alert">
          {error}
        </p>
      )}
      {!!rows.length && (
        <>
          <p className="p-success">{rows.length} orders ready to import.</p>
          <div className="p-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Customer</th>
                  <th>Quantity</th>
                  <th>Deadline</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 10).map((r) => (
                  <tr key={r.number}>
                    <td>{r.number}</td>
                    <td>{r.customer}</td>
                    <td>{r.quantity}</td>
                    <td>{r.deadline}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 10 && <small>Showing the first 10 rows.</small>}
        </>
      )}
    </FormDialog>
  );
}
