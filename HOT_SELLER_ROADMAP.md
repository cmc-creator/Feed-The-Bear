# Feed The Bear - Hot Seller Roadmap

## North Star
Help people decide what to eat in under 60 seconds, with confidence.

## Success Metrics
- Activation: first save + first decision session in day 1
- Core value: decision sessions completed per user per week
- Retention: D7 and D30 for users who completed >=3 decision sessions
- Conversion: free-to-paid within 14 days
- Trust: nearby card skip rate due to irrelevant image/data

## Current Strengths (Already in App)
- Nearby discovery and rich nearby cards
- Bear Swipe preference loop
- Smart planner and recommendation surfaces
- Premium plan surfaces (Cub/Grizzly + upgrade modal)
- Sharing and social hooks (cards, challenge/room flows)

## Phase 1 (Week 1): Decision Engine That Converts
Goal: make one workflow feel magical and fast.

### Build
1. 60-second Decision Mode (new focused flow)
- Inputs: mood, budget, distance, party size
- Output: top 3 shortlist with one winner CTA

2. Decision confidence labels
- Show: image confidence, menu availability, distance confidence

3. Frictionless completion
- Buttons: Choose this, Save backup, Open directions, View menu

### Acceptance Criteria
- User can go from launch to winner in <=60 seconds
- At least 80% of decision sessions end with a concrete action

## Phase 2 (Week 2): Trust Layer (Data Quality)
Goal: remove bad cards and make content feel reliable.

### Build
1. Relevance scoring for nearby card media
- Cuisine match score
- Place-image vs food-image source quality score
- Watermark/domain blocklist

2. Source fallback hierarchy
- Restaurant-provided photo
- Place photo (high confidence only)
- Cuisine-locked local food image

3. Menu link enrichment
- Keep menu button available for all nearby cards
- Prefer known website + menu route, else search fallback

### Acceptance Criteria
- Major cuisine/image mismatch rate reduced by >=70%
- Nearby cards always expose either Menu or Website or both

## Phase 3 (Week 3): Monetization and Packaging
Goal: make premium feel outcome-based.

### Build
1. Premium outcomes, not feature lists
- Decision Mode Pro: advanced constraints and tie-breaker AI
- Group vote winner mode (no-login guest voting)
- Weekly digest with personalized shortlist

2. Upgrade moments
- Trigger upgrade after repeated high-value actions
- Contextual copy tied to immediate user goal

3. Pricing experiments
- Monthly vs annual framing
- Founding member annual offer

### Acceptance Criteria
- Upgrade CTA CTR improves week over week
- Free-to-paid conversion baseline established and improving

## Phase 4 (Week 4): Growth Loops and Distribution
Goal: increase referrals and habit loops.

### Build
1. Shareable winner cards
- "Tonight's Winner" with install/deep link

2. Referral loop
- Invite 2, get 1 month Grizzly

3. Weekly reactivation
- "3 picks for tonight" digest with one-tap re-entry

### Acceptance Criteria
- Referral-attributed installs tracked
- Weekly returning users trend upward

## Product Rules (Non-Negotiable)
1. Every screen must shorten time-to-decision.
2. Any unreliable data must be labeled or hidden.
3. No premium gate on core trust and utility.
4. Premium should feel 10x better in outcome quality.

## Build Order (Engineering)
1. Instrument events and dashboards first.
2. Ship Decision Mode V1.
3. Improve media/menu trust signals.
4. Add premium packaging and experiments.
5. Add growth loops after core conversion quality is stable.

## Instrumentation Events To Track
- decision_session_started
- decision_session_completed
- decision_option_selected
- nearby_card_saved
- nearby_menu_opened
- nearby_website_opened
- nearby_directions_opened
- upgrade_modal_opened
- upgrade_cta_clicked
- plan_purchased
- share_winner_opened
- share_winner_completed
- referral_link_copied

## Next Build Ticket (Start Here)
Implement Decision Mode V1 with:
- quick constraint chips
- top-3 shortlist renderer
- winner selection CTA
- event tracking for start and completion
