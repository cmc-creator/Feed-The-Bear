# Store listing: Feed the Bear

Copy for the Apple App Store and Google Play. Character limits are noted; every field below fits.
Screenshots: `store/screenshots/ios-6.9/` (1290×2796, iPhone 6.9") and `store/screenshots/android/` (1080×1920).
Regenerate them with `node scripts/store_screenshots.js` while the local server runs on port 8765.

## Both stores

**App name** (30): Feed the Bear: Food Diary

**Category:** Food & Drink

## Apple App Store

**Subtitle** (30): Save spots. Decide dinner fast

**Promotional text** (170):
Never forget a great dish again. Save the spots you love, see what's open right now, and let the bear pick dinner when nobody can decide.

**Keywords** (100):
restaurant,food diary,where to eat,dinner ideas,foodie,menu,dishes,wishlist,date night,tracker

## Google Play

**Short description** (80):
Your food diary: save spots, remember what to order, and decide dinner fast.

## Description (both stores, 4000)

Can't remember what you ordered last time? Stuck in the "where should we eat?" loop again? Feed the Bear is the food diary that fixes both.

SAVE EVERY GREAT SPOT
• Add a restaurant in ten seconds, from what's near you or a Maps link
• Rate it, snap the dish, and note what to get again and what to skip
• Keep a Crave List of dishes you're dying to try

KNOW BEFORE YOU GO
• Google rating, price and this week's hours on every spot
• "Open right now" shows which of your saved spots are serving this minute
• Tap to call or get directions

DECIDE DINNER, FAST
• Swipe to Decide: swipe your saved spots down to a winner
• Spin the Wheel, Restaurant Duel and Tonight's Pick when nobody can choose
• Bear Swipe learns your taste from real dish photos

EAT WITH FRIENDS
• Follow friends and see where they eat and what they order
• Save a friend's favorite to your list in one tap
• Group Vote and Dinner Rooms settle where the crew is going

MAKE IT FUN
• Earn badges, stamp your Foodie Passport and fill Cuisine Bingo
• Share story cards of your best meals
• Your year in food, wrapped

Free to start with up to 15 spots and backup on every device with a free account. Grizzly unlocks unlimited spots, Byte Cub AI picks and summaries, Year in Review and 15-second food videos.

## What's new (first release)

Welcome to Feed the Bear! Save your spots, see what's open, and let the bear help pick dinner.

## Still needed before submitting

- Apple Developer account ($99/year) and Google Play Console account ($25 one time).
- A privacy policy URL. The app stores sign-in email, saved spots and photos (Firebase) and uses location only while the app is open.
- A support URL or email.
- Packaging: Feed the Bear is a web app. Google Play can take it as a Trusted Web Activity (built with Bubblewrap; needs a `/.well-known/assetlinks.json` on the site). Apple needs a native wrapper (for example Capacitor) and must offer real app features beyond the website, which Feed the Bear does.
