/**
 * ResponsiveTable — one primitive, twelve tables fixed (val 2026-06-07).
 * Desktop renders a real <table>; below 768px each row becomes a stacked
 * label/value card with the `primary` column as the card header. `mobileHide`
 * columns drop on phones to keep cards short. Operator dark register.
 *
 *   <ResponsiveTable
 *     columns={[
 *       { key: 'company', label: 'Company', primary: true },
 *       { key: 'score',   label: 'Score', align: 'right' },
 *       { key: 'updated', label: 'Updated', mobileHide: true },
 *     ]}
 *     rows={rows}
 *     rowKey={(r) => r.id}
 *     renderRow={(r) => ({ company: <Link…/>, score: r.score, updated: r.ago })}
 *   />
 *
 * No 'use client' — it's pure presentation, safe in server pages.
 */
import type { ReactNode } from 'react';
import './restable.css';

export interface RTColumn {
  key: string;
  label: string;
  /** The card header on mobile. Exactly one column should set this. */
  primary?: boolean;
  /** Drop this column from the mobile card (keeps cards short). */
  mobileHide?: boolean;
  align?: 'left' | 'right';
}

interface Props<T> {
  columns: RTColumn[];
  rows: T[];
  rowKey: (r: T) => string | number;
  renderRow: (r: T) => Record<string, ReactNode>;
  empty?: ReactNode;
}

export default function ResponsiveTable<T>({ columns, rows, rowKey, renderRow, empty }: Props<T>) {
  if (rows.length === 0) {
    return <div className="rt-empty">{empty ?? 'Nothing here yet.'}</div>;
  }
  const primary = columns.find((c) => c.primary);
  return (
    <div className="rt">
      <table className="rt-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align === 'right' ? 'rt-r' : undefined}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const cells = renderRow(r);
            return (
              <tr key={rowKey(r)}>
                {columns.map((c) => (
                  <td key={c.key} className={c.align === 'right' ? 'rt-r' : undefined}>{cells[c.key]}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="rt-cards">
        {rows.map((r) => {
          const cells = renderRow(r);
          return (
            <div className="rt-card" key={rowKey(r)}>
              {primary && <div className="rt-card-h">{cells[primary.key]}</div>}
              <dl className="rt-dl">
                {columns.filter((c) => !c.primary && !c.mobileHide).map((c) => (
                  <div className="rt-row" key={c.key}>
                    <dt>{c.label}</dt>
                    <dd>{cells[c.key]}</dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
      </div>
    </div>
  );
}
