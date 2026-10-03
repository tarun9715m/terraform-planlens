import { movedBlock } from './insight';
import { byRisk, reasonText, type Kind } from './model';
import type { PlanModel } from './plan';
import { plural } from './util';

/** A short Markdown summary of the plan, for pasting into a pull request or chat. */
export function summaryMarkdown(pm: PlanModel): string {
  const g = pm.g, c = g.c;
  const extra = (['import', 'move', 'forget', 'read'] as Kind[]).filter(k => c[k]).map(k => `${c[k]} to ${k}`);
  const lines = [`**Terraform plan** · ${c.create} to create · ${c.update} to update · ${c.replace} to replace · ${c.delete} to destroy${extra.length ? ' · ' + extra.join(' · ') : ''}`];
  const risky = pm.model.filter(r => r.destructive).sort(byRisk);
  if (risky.length) {
    lines.push('', '**Review first**');
    for (const r of risky) lines.push(`- \`${r.glyph}\` \`${r.address}\`: ${reasonText(r, pm)}${r.warn.length ? ` (${r.warn.map(w => w.t).join(', ')})` : ''}`);
  }
  if (pm.renames.length) {
    lines.push('', '**Possible renames.** Add these `moved` blocks to keep the resources instead of destroying them:', '```hcl', pm.renames.map(movedBlock).join('\n\n'), '```');
  }
  if (pm.drift.length) lines.push('', `**Drift:** ${plural(pm.drift.length, 'resource')} changed outside Terraform${g.driftHidden ? `, ${g.driftHidden} of them not printed by terraform plan` : ''}.`);
  if (g.secrets) lines.push('', `**Heads-up:** ${plural(g.secrets, 'value')} ${g.secrets === 1 ? 'looks' : 'look'} like a secret but ${g.secrets === 1 ? "isn't" : "aren't"} marked sensitive.`);
  return lines.join('\n');
}
