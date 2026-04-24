/* ---------- ARTICLE (claims are events in the given-log) ---------- */
/* Each run is a text fragment; claims have .id and a :claim marker.       */
const ARTICLE = [
  { p: [
    { t: 'The Nashville Downtown Partnership received ' },
    { t: '$4.2 million', c: 'm1' },
    { t: ' in public funds during fiscal year 2025, a ' },
    { t: '14.3 percent increase', c: 'm2' },
    { t: ' over the prior year, according to budget documents obtained from Metro Finance. The increase followed a motion by ' },
    { t: 'Councilmember Torres', c: 'm3' },
    { t: ' on ' },
    { t: 'March 7', c: 'm4' },
    { t: ' to amend the public safety allocation.' }
  ]},
  { p: [
    { t: 'The Partnership has contracted with ' },
    { t: 'Solaren International', c: 'm5' },
    { t: ' for private security services since ' },
    { t: '2019', c: 'm6' },
    { t: ', at a cost the organization describes as ' },
    { t: '$280,000 annually', c: 'c1' },
    { t: '. Internal documents reviewed by this reporter put the figure at ' },
    { t: '$312,000', c: 'm7' },
    { t: ', a discrepancy the Partnership has not publicly explained.' }
  ]},
  { p: [
    { t: "Metro's Office of Homeless Services " },
    { t: 'did not respond to requests for comment', c: 'a1' },
    { t: " about the overlap between the Partnership's security footprint and OHS encampment clearance operations. " },
    { t: 'No disclosure of the Solaren contract', c: 'a2' },
    { t: " appears in the Partnership's public filings for the period." }
  ]}
];
