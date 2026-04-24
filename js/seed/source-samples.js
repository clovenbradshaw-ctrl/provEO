/* ---------- SEED SOURCE CONTENT ----------
   Made-up but self-consistent content for the four read-only demo sources
   above, so the source viewer shows something real when users click a seed
   or follow a provenance chip into one. Row numbers, line numbers, and
   quoted passages here are the contract that SEED_CLAIMS provenance refers
   to — keep them aligned when editing either side.
============================================================================ */
const SOURCE_SAMPLES = (function () {
  // ---- ndp_budget_fy25.csv ----
  // 9-column ledger; rows 112–116 carry the five public_safety line items
  // summed by m1 (totals $4,231,440 ≈ $4.2M); rows 199–203 carry the vendor
  // overtime slice referenced by m7 (row 201 = Solaren $312,000 actual).
  const NDP_POOL = [
    ['V-0012','Music City Maintenance','janitorial','operations'],
    ['V-0023','Downtown Ambassadors','ambassador_hours','programming'],
    ['V-0047','Tennessee Traffic Solutions','signal_timing','infrastructure'],
    ['V-0112','Broadway Event Logistics','event_support','programming'],
    ['V-0134','Cumberland Landscaping','tree_pruning','operations'],
    ['V-0156','Nashville Printworks','signage','marketing'],
    ['V-0178','GraniteStep Stonework','sidewalk_repair','infrastructure'],
    ['V-0201','Midstate Power Wash','pressure_wash','operations'],
    ['V-0233','Riverbend Lighting','holiday_lights','programming'],
    ['V-0267','Bluebird Waste','trash_collection','operations'],
    ['V-0289','Oakhill Security Tech','camera_maintenance','public_safety'],
    ['V-0315','Harpeth Office Supply','office_supplies','admin'],
    ['V-0342','Eastside Glass & Door','storefront_repair','infrastructure'],
    ['V-0388','Cornerstone Legal','legal_services','admin']
  ];
  const NDP_OVERRIDES = {
    112: ['V-0088','Solaren International','foot_patrol_contract','public_safety','$823,400','','',''],
    113: ['V-0289','Oakhill Security Tech','camera_expansion_phase2','public_safety','$1,104,200','','',''],
    114: ['V-0088','Solaren International','ambassador_security_augment','public_safety','$890,000','','',''],
    115: ['V-0088','Solaren International','late_night_coverage','public_safety','$712,840','','',''],
    116: ['V-0289','Oakhill Security Tech','transit_node_cameras','public_safety','$701,000','','',''],
    199: ['V-0447','Brightway Cleaning','janitorial','operations','','$18,000','$19,240','+$1,240'],
    200: ['V-0519','Metro Signs LLC','wayfinding','marketing','','$4,200','$4,200','$0'],
    201: ['V-0088','Solaren International','security_overtime','public_safety','','$280,000','$312,000','+$32,000'],
    202: ['V-0088','Solaren International','security_base','public_safety','','$520,000','$520,000','$0'],
    203: ['V-0612','Nashville Pressure Wash','sidewalk_cleaning','operations','','$14,000','$13,880','−$120']
  };
  // CSV field quoter: any cell containing a comma, quote, or newline gets
  // wrapped in double quotes with embedded quotes doubled (RFC 4180). Most
  // money cells below contain commas, so without this the ledger would
  // split into ragged rows.
  const csvCell = v => {
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const ndpLines = ['row,vendor_id,vendor_name,line_item,category,amount,overtime_budget,overtime_actual,variance'];
  for (let r = 1; r <= 210; r++) {
    let cells;
    if (NDP_OVERRIDES[r]) {
      cells = [r, ...NDP_OVERRIDES[r]];
    } else {
      const v = NDP_POOL[(r * 7 + 3) % NDP_POOL.length];
      const amount = '$' + (1200 + ((r * 7919) % 48000)).toLocaleString('en-US');
      cells = [r, v[0], v[1], v[2], v[3], amount, '', '', ''];
    }
    ndpLines.push(cells.map(csvCell).join(','));
  }
  const ndp = ndpLines.join('\n');

  // ---- council_minutes_mar7.pdf (rendered as plain-text extraction) ----
  // Verbatim substrings required by m3 (Torres passage), m4 (dated header),
  // and c1 (Ellwood's "$280,000 annually" testimony).
  const min = [
    'Metropolitan Council of Nashville and Davidson County',
    'Regular Session · March 7, 2026',
    'Council Chamber · 1:00 p.m.',
    '',
    'Presiding: Vice Mayor Marisol Park',
    'Clerk: Henry Ashford',
    '',
    'Roll call: 32 of 40 members present. Councilmembers Aldridge, Burch, and Redwin excused. A quorum was declared at 1:04 p.m.',
    '',
    'The minutes of the February 21 regular session were approved without objection.',
    '',
    'Public comment period opened at 1:11 p.m. Twelve speakers were heard on matters including the Midtown greenway easement, the proposed short-term rental ordinance, and the FY26 budget framework. Public comment closed at 2:40 p.m.',
    '',
    "The meeting resumed at 2:47 p.m. following the public comment period. Councilmember Torres introduced an amendment to the public safety appropriation, moving that $500,000 be redirected from the general fund reserve to the Downtown Partnership's security operations line.",
    '',
    'Partnership President David Ellwood, speaking in support of the amendment, stated that the organization\'s contract with its private security provider "represents an ongoing cost of approximately $280,000 annually" and that the proposed increase would cover expanded coverage in the Gulch and SoBro districts.',
    '',
    'Councilmember Aldana asked whether the expanded footprint would overlap with ongoing Metro Office of Homeless Services outreach operations. Councilmember Torres responded that coordination with OHS was "a matter to be worked out administratively, not through appropriations," and declined to offer further detail.',
    '',
    'A motion to table the amendment, offered by Councilmember Yee, failed on a voice vote (12 ayes, 20 nays).',
    '',
    'The amendment was adopted on roll call vote: 21 ayes, 9 nays, 2 abstentions. Voting aye: Torres, Park, Ellis, Hatfield, Kim, Nakamura, Obregon, Patel, Quincy, Ramirez, Suttle, Trent, Umeh, Valdez, Wright, Xian, Yarbrough, Zane, Arkwright, Bell, Cho. Voting nay: Aldana, Yee, Brooks, Davenport, Ng, Okafor, Price, Rhee, Singh. Abstaining: Marsh, Kowalski.',
    '',
    'The consent agenda was adopted as presented (voice vote, no objection).',
    '',
    'The meeting adjourned at 3:52 p.m. The next regular session is scheduled for March 21, 2026 at 1:00 p.m.',
    '',
    '— End of minutes · prepared by the Office of the Clerk, Metropolitan Council —'
  ].join('\n');

  // ---- ohs_quarterly_q4.pdf (rendered as plain-text extraction) ----
  // Deliberately silent on Solaren and on NDP coordination so the a1/a2
  // absence claims stand up to a reader who checks. "\f" separators mark
  // page breaks — the fixture PDF renderer splits here to produce the
  // 3-page visual rendering that matches the "3 pp" meta.
  const ohs = [
    'Office of Homeless Services',
    'Quarterly Report · Q4 FY2025',
    'Report submitted: January 22, 2026',
    'Prepared by: OHS Research & Evaluation Unit',
    '',
    '1. Executive Summary',
    '',
    'During the fourth quarter of fiscal year 2025, the Office of Homeless Services (OHS) continued to implement the Housing First framework adopted by Metro Council in 2022. Core performance indicators are summarized in Section 2. A full outreach contact roster is included as Appendix A.',
    '',
    'Headline figures for Q4 FY25:',
    '  • 1,412 unique individuals contacted by street outreach (up 7.2% YoY)',
    '  • 318 placements into emergency shelter',
    '  • 141 placements into bridge and rapid rehousing',
    '  • 22 encampment sites resolved in coordination with Parks and Police',
    '',
    '2. Outreach Contact Counts',
    '',
    '  District              Contacts    Enrollments',
    '  Downtown Core             284             78',
    '  East Nashville            192             41',
    '  Antioch                   147             22',
    '  Bellevue                   63             12',
    '  Madison                   105             19',
    '  Other                     621            187',
    '',
    '3. Encampment Resolutions',
    '',
    'Twenty-two encampment sites were resolved during the quarter. All resolutions followed the 14-day notice protocol adopted in 2023. Each case is documented in the HMIS record with photographs, belongings-intake forms, and outreach worker narratives. Appendix C summarizes dates and dispositions.',
    '\f',
    '4. Material Contracts',
    '',
    'OHS maintained the following material service contracts during the quarter. A "material contract" is defined for the purposes of this report as any agreement with a single vendor totaling $100,000 or more per fiscal year.',
    '',
    '  Vendor                          Service                        Annual Value',
    '  Mercy Bridge Shelter            Emergency shelter beds         $2,140,000',
    '  Tennessee Housing Navigators    Case management                $896,400',
    '  Crosswalk Outreach              Street outreach                $612,000',
    '  Harbor Medical Mobile           On-site clinical services      $404,200',
    '  Keystone Food Services          Meal service                   $288,000',
    '  Northstar Data Systems          HMIS database hosting          $142,800',
    '',
    'No new material contracts were executed during the quarter. No material contracts were terminated. All renewals followed Metro Procurement regulations and are on file with the Division of Purchases.',
    '\f',
    '5. Interagency Coordination',
    '',
    'OHS participated in the monthly Interagency Task Force convened by the Mayor\'s Office (Parks, Police, Public Works, Fire, and Health). Coordination with non-governmental partners is conducted through the Community Advisory Committee and is documented in the Committee\'s published minutes.',
    '',
    '6. Open Items',
    '',
    '  • Data migration to the v3 HMIS schema remains in progress; expected completion Q1 FY26.',
    '  • The Housing First practice audit is scheduled for Q2 FY26.',
    '  • Outreach staffing is below target by 2.0 FTE; recruitment is ongoing.',
    '',
    'Appendix A — Outreach Contact Roster (redacted · 31 pp. in full version)',
    'Appendix B — Budget-to-Actuals',
    'Appendix C — Encampment Case Summaries',
    '',
    '— End of report —'
  ].join('\n');

  // ---- vendor_contracts.txt ----
  // Line 88 must name Solaren International so m5/m6 chips resolve.
  const VEN_POOL = [
    ['Music City Maintenance','MCM LLC','Janitorial services','2020-01-15','2026-12-31'],
    ['Downtown Ambassador Services','DAS Inc.','Ambassador program','2018-07-01','2026-06-30'],
    ['Broadway Event Logistics','BEL Partners','Event support & staging','2021-05-10','2026-11-30'],
    ['Cumberland Landscaping','Cumberland Group LLC','Tree pruning & landscaping','2019-03-01','2027-02-28'],
    ['Nashville Printworks','Printworks TN','Signage & print','2022-02-14','2026-08-31'],
    ['GraniteStep Stonework','GraniteStep LLC','Sidewalk & stonework repair','2020-09-22','2026-09-30'],
    ['Midstate Power Wash','Midstate Services','Pressure washing','2021-11-01','2026-10-31'],
    ['Riverbend Lighting','Riverbend Co.','Holiday & seasonal lighting','2019-10-15','2027-01-14'],
    ['Bluebird Waste','Bluebird Waste LLC','Trash & recycling collection','2018-04-01','2026-03-31'],
    ['Oakhill Security Tech','Oakhill Tech','Camera maintenance','2022-06-01','2027-05-31'],
    ['Harpeth Office Supply','Harpeth Office','Office supplies','2021-01-01','2025-12-31'],
    ['Brightway Cleaning','Brightway Cleaning Inc.','Specialized cleaning','2020-05-04','2026-05-03']
  ];
  const venLines = [
    'Nashville Downtown Partnership · Vendor Contract Register',
    'Source: NDP Procurement Office · Exported: 2026-01-12',
    'Format: one vendor per line · fields separated by " · "',
    ''
  ];
  for (let i = 1; i <= 104; i++) {
    const n = String(i).padStart(2, '0');
    if (i === 88) {
      venLines.push(`Line ${n} — Vendor: Solaren International (Solaren Intl., LLC) · Contract type: Private security services · Effective: 2019-04-01 · Current term expires: 2027-03-31`);
    } else {
      const v = VEN_POOL[(i * 5 + 2) % VEN_POOL.length];
      venLines.push(`Line ${n} — Vendor: ${v[0]} (${v[1]}) · Contract type: ${v[2]} · Effective: ${v[3]} · Current term expires: ${v[4]}`);
    }
  }
  const ven = venLines.join('\n');

  return { ndp, min, ohs, ven };
})();
