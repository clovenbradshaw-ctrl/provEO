/* ---------- SEED_CLAIMS (fold output — what the nine-case dispatch produced) */
/* Each claim has a typed `prov` field describing HOW it came from its source.
   The panel renders based on prov.kind:
     quote    → PDF sentence in context, span highlighted
     cell     → CSV row/col tuple with neighboring cells
     derived  → expression + drillable list of input provenances (recursive)
     conflict → two stacked provenances + delta
     absence  → what was expected, where we scanned, what's missing          */
const SEED_CLAIMS = {
  m1: {
    type: 'grounded',
    text: '$4.2 million',
    conf: 1.00,
    status: 'pending',
    prov: {
      kind: 'derived',
      expr: 'SUM(amount) WHERE dept = public_safety AND fy = 2025',
      op: 'SUM',
      result: '$4,231,440',
      display: '$4.2 million',
      inputs: [
        { kind: 'cell', src: 'ndp_budget_fy25.csv', row: 112, col: 'amount', value: '$823,400' },
        { kind: 'cell', src: 'ndp_budget_fy25.csv', row: 113, col: 'amount', value: '$1,104,200' },
        { kind: 'cell', src: 'ndp_budget_fy25.csv', row: 114, col: 'amount', value: '$890,000' },
        { kind: 'cell', src: 'ndp_budget_fy25.csv', row: 115, col: 'amount', value: '$712,840' },
        { kind: 'cell', src: 'ndp_budget_fy25.csv', row: 116, col: 'amount', value: '$701,000' }
      ]
    },
    trace: [
      { op: 'SIG', txt: 'value pattern <code>\\$[\\d.]+M</code> hit — six occurrences aggregated' },
      { op: 'INS', txt: 'document anchor minted for <strong>public_safety_2025</strong> line set' },
      { op: 'CON', txt: 'linked to NDP entity via <strong>recipient_id</strong> column' },
      { op: 'DEF', txt: '<strong>SUM</strong> evaluated: $4,231,440 → rounded presentation $4.2M' }
    ]
  },
  m2: {
    type: 'grounded',
    text: '14.3 percent increase',
    conf: 1.00,
    status: 'pending',
    prov: {
      kind: 'derived',
      expr: '(SUM_2025 − SUM_2024) / SUM_2024 × 100',
      op: 'PCT_DELTA',
      result: '14.26%',
      display: '14.3%',
      inputs: [
        {
          kind: 'derived',
          expr: 'SUM(amount) WHERE fy=2025',
          op: 'SUM',
          result: '$4,231,440',
          label: 'FY2025 public safety total'
        },
        {
          kind: 'derived',
          expr: 'SUM(amount) WHERE fy=2024',
          op: 'SUM',
          result: '$3,702,260',
          label: 'FY2024 public safety total'
        }
      ]
    },
    trace: [
      { op: 'SIG', txt: 'year field populated on two disjoint row ranges' },
      { op: 'DEF', txt: 'delta computed: (4,231,440 − 3,702,260) / 3,702,260 = 0.1426' }
    ]
  },
  m3: {
    type: 'grounded',
    text: 'Councilmember Torres',
    conf: 0.97,
    status: 'pending',
    prov: {
      kind: 'quote',
      src: 'council_minutes_mar7.pdf',
      page: 4,
      before: "The meeting resumed at 2:47 p.m. following the public comment period. ",
      highlight: "Councilmember Torres",
      after: " introduced an amendment to the public safety appropriation, moving that $500,000 be redirected from the general fund reserve to the Downtown Partnership's security operations line.",
      spanLabel: 'p.4 · span[1204:1220]'
    },
    trace: [
      { op: 'SIG', txt: 'PERSON pattern hit; surface form "Councilmember Torres"' },
      { op: 'INS', txt: 'anchor minted for <strong>person:torres_v</strong>' },
      { op: 'CON', txt: 'coref chain resolved — three downstream "she" mentions linked' }
    ]
  },
  m4: {
    type: 'grounded',
    text: 'March 7',
    conf: 0.99,
    status: 'pending',
    prov: {
      kind: 'quote',
      src: 'council_minutes_mar7.pdf',
      page: 1,
      before: "Metropolitan Council of Nashville and Davidson County\nRegular Session · ",
      highlight: "March 7, 2026",
      after: "\nCouncil Chamber · 1:00 p.m.",
      spanLabel: 'p.1 · header'
    },
    trace: [
      { op: 'SIG', txt: 'DATE pattern on meeting header' }
    ]
  },
  m5: {
    type: 'grounded',
    text: 'Solaren International',
    conf: 0.94,
    status: 'pending',
    prov: {
      kind: 'quote',
      src: 'vendor_contracts.txt',
      page: null,
      before: "Line 88 — Vendor: ",
      highlight: "Solaren International",
      after: " (Solaren Intl., LLC) · Contract type: Private security services · Effective: 2019-04-01 · Current term expires: 2027-03-31",
      spanLabel: 'line 88'
    },
    trace: [
      { op: 'SIG', txt: 'ORG pattern hit' },
      { op: 'INS', txt: 'anchor minted: <strong>org:solaren_intl</strong>' }
    ]
  },
  m6: {
    type: 'grounded',
    text: '2019',
    conf: 0.93,
    status: 'pending',
    prov: {
      kind: 'quote',
      src: 'vendor_contracts.txt',
      page: null,
      before: "Line 88 — Vendor: Solaren International · Contract type: Private security services · Effective: ",
      highlight: "2019-04-01",
      after: " · Current term expires: 2027-03-31",
      spanLabel: 'line 88 · effective date'
    },
    trace: [
      { op: 'SIG', txt: 'year pattern; full date 2019-04-01 captured, year-only surface form' }
    ]
  },
  m7: {
    type: 'grounded',
    text: '$312,000',
    conf: 1.00,
    status: 'pending',
    prov: {
      kind: 'cell',
      src: 'ndp_budget_fy25.csv',
      row: 201,
      col: 'overtime_actual',
      value: '$312,000',
      // neighboring context: a few columns around the target, a few rows above and below
      headers: ['row', 'vendor_id', 'vendor_name', 'line_item', 'overtime_budget', 'overtime_actual', 'variance'],
      rows: [
        [199, 'V-0447', 'Brightway Cleaning',    'janitorial',          '$18,000',  '$19,240',  '+$1,240'],
        [200, 'V-0519', 'Metro Signs LLC',       'wayfinding',          '$4,200',   '$4,200',   '$0'],
        [201, 'V-0088', 'Solaren International', 'security_overtime',   '$280,000', '$312,000', '+$32,000'],
        [202, 'V-0088', 'Solaren International', 'security_base',       '$520,000', '$520,000', '$0'],
        [203, 'V-0612', 'Nashville Pressure Wash','sidewalk_cleaning',  '$14,000',  '$13,880',  '−$120']
      ]
    },
    trace: [
      { op: 'SIG', txt: 'value pattern hit on row 201' },
      { op: 'INS', txt: 'anchor minted: <strong>contract_line_201</strong>' }
    ]
  },
  c1: {
    type: 'conflict',
    text: '$280,000 annually',
    conf: 0.90,
    status: 'pending',
    prov: {
      kind: 'conflict',
      reported: {
        kind: 'quote',
        src: 'council_minutes_mar7.pdf',
        page: 4,
        before: "Partnership President David Ellwood, speaking in support of the amendment, stated that the organization's contract with its private security provider ",
        highlight: "\"represents an ongoing cost of approximately $280,000 annually\"",
        after: " and that the proposed increase would cover expanded coverage in the Gulch and SoBro districts.",
        spanLabel: 'p.4 · testimony span'
      },
      source: {
        kind: 'cell',
        src: 'ndp_budget_fy25.csv',
        row: 201,
        col: 'overtime_actual',
        value: '$312,000'
      },
      delta: '+$32,000',
      deltaPct: '+11.4%'
    },
    trace: [
      { op: 'SIG', txt: 'value pattern matched in both sources' },
      { op: 'CON', txt: 'both anchors route to org:solaren_intl' },
      { op: 'EVA', txt: 'value mismatch detected → <strong>conflict event emitted</strong>' },
      { op: 'DEF', txt: 'neither value preferred — both held in superposition' }
    ]
  },
  a1: {
    type: 'absent',
    text: 'did not respond to requests for comment',
    conf: 0.85,
    status: 'pending',
    prov: {
      kind: 'absence',
      expected: 'A response from <em>Office of Homeless Services</em> press contact, within a 14-day window of three contact attempts.',
      scanned: [
        { src: 'inbox.mbox', note: 'three outbound, zero reply' },
        { src: 'ohs_press_releases.xml', note: 'no press release mentioning NDP coordination' },
        { src: 'ohs_quarterly_q4.pdf', note: 'no relevant section' }
      ],
      window: 'Feb 18 – Mar 4, 2026'
    },
    trace: [
      { op: 'NUL', txt: 'absence pattern probed: <strong>OHS response</strong> in 14-day window' },
      { op: 'SIG', txt: 'no matching anchor in ohs_quarterly_q4 or related threads' },
      { op: 'EVA', txt: 'absence stands — three contact attempts logged, zero replies' }
    ]
  },
  a2: {
    type: 'absent',
    text: 'No disclosure of the Solaren contract',
    conf: 0.88,
    status: 'pending',
    prov: {
      kind: 'absence',
      expected: 'A <em>material contracts</em> or <em>related-party transactions</em> disclosure naming Solaren International, expected in Q1–Q4 2025 Partnership filings.',
      scanned: [
        { src: 'ohs_quarterly_q4.pdf', note: '§ "material contracts" — no Solaren mention' },
        { src: 'ndp_annual_990.pdf',   note: 'Schedule O — no vendor disclosed above threshold' },
        { src: 'tn_sos_filings/',       note: 'no amendment filings referencing Solaren' }
      ],
      window: 'Jan 1 – Dec 31, 2025'
    },
    trace: [
      { op: 'NUL', txt: 'disclosure pattern probed against Q4 filing schema' },
      { op: 'SIG', txt: 'no "material contracts" section references Solaren' },
      { op: 'EVA', txt: 'absence stands across Q1–Q4 2025 filings' }
    ]
  }
};
