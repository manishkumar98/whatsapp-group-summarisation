// Nia Community → Studio group mapping
// Groups matched by name substring (case-insensitive)
// Announcements groups are excluded from digests

const COMMUNITY_MAP = {
  'Rajputana': [
    'sarveen', 'narendra', 'shiv kumar', 'ompal'
  ],
  'Deccan': [
    'sandeep', 'mahesh misal', 'baban misal', 'navnath', 'sunil sahu',
    'dhiraj', 'jawlea', 'vaibav', 'mauli', 'mahendra', 'kashid',
    'bala saheb', 'lokesh soni', 'nitin gawde', 'deepak'
  ],
  'Wellington': [
    'shivaji nagar', 'shivaji nagar (central)', 'nia nest britto', 'britto',
    'nia nest murali', 'murali', 'govindraj', 'umapahti', 'raghu',
    'venkatesh reddy', 'shrinivasan', 'santhose', 'hemanth', 'ananth kumar',
    'venkatesha', 'senthil kumar', 'uma devi', 'ravikumar', 'mahadeva',
    'muniyappa', 'muniraj', 'kiran kumar', 'naresh', 'dayananda sagar',
    'jay kumar', 'kavyashree', 'shankar', 'setlite', 'shanti nagar',
    'aruna', 'uday kumar'
  ],
  'Coromandel': [
    'chennai menka', 'menka ramdas', 'saralavathi', 'kothandaraman',
    'kalyan kumar', 'sharmila ladies', 'sharmila gents', 'parvesh'
  ],
};

// Community colors using Nia palette
const COMMUNITY_COLORS = {
  'Wellington':  { primary: '#2C5880', light: '#EEF4F9', label: 'WLG' },
  'Deccan':      { primary: '#2D8659', light: '#E8F5EE', label: 'DN'  },
  'Coromandel':  { primary: '#E06D1F', light: '#FEF5ED', label: 'CORO' },
  'Rajputana':   { primary: '#C45D1A', light: '#FBE4D1', label: 'RN'  },
  'Uncategorised':{ primary: '#767676', light: '#F5F5F7', label: '—'  },
};

function getCommunity(groupName) {
  if (!groupName) return 'Uncategorised';
  const lower = groupName.toLowerCase();

  // Skip announcement groups
  if (lower.includes('announcement')) return null;
  if (lower.includes('nia wellington community') ||
      lower.includes('nia deccan community') ||
      lower.includes('nia rajputana community') ||
      lower.includes('nia coromandel community')) return null;

  for (const [community, keywords] of Object.entries(COMMUNITY_MAP)) {
    if (keywords.some(k => lower.includes(k))) return community;
  }
  return 'Uncategorised';
}

module.exports = { COMMUNITY_MAP, COMMUNITY_COLORS, getCommunity };
