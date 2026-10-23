"""Build data/food-photos.json: real, credited food photos for Bear Swipe.

For each dish below:
  1. the lead image of its Wikipedia article (editor-picked, shows the dish), then
  2. photos used to illustrate the dish in up to 20 language Wikipedias, ranked
     by how many editions use them (browsing Commons categories pulled in signs,
     stalls and markets), filtered to real, freely licensed photos of decent size.
Images are served from Wikimedia's own 800px thumbnails; we store the URL plus
the author and license, which the app shows on each card.

Usage: python scripts/build_food_photos.py [--per-dish 8]
"""
import argparse
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request

UA = 'FeedTheBear/1.0 (https://feed-the-bear.vercel.app; food photo manifest builder)'
WIKI = 'https://en.wikipedia.org/w/api.php'
WIKIDATA = 'https://www.wikidata.org/w/api.php'
COMMONS = 'https://commons.wikimedia.org/w/api.php'
THUMB_WIDTH = 800

# (label shown on the card, Wikipedia article, cuisine)
DISHES = [
    # American
    ('Cheeseburger', 'Cheeseburger', 'American'), ('Hamburger', 'Hamburger', 'American'),
    ('French fries', 'French fries', 'American'), ('Hot dog', 'Hot dog', 'American'),
    ('Buffalo wings', 'Buffalo wing', 'American'), ('Mac and cheese', 'Macaroni and cheese', 'American'),
    ('Grilled cheese', 'Cheese sandwich', 'American'), ('Club sandwich', 'Club sandwich', 'American'),
    ('BLT', 'BLT', 'American'), ('Reuben sandwich', 'Reuben sandwich', 'American'),
    ('Philly cheesesteak', 'Cheesesteak', 'American'), ('Meatloaf', 'Meatloaf', 'American'),
    ('Clam chowder', 'Clam chowder', 'American'), ('Lobster roll', 'Lobster roll', 'American'),
    ('Chicken pot pie', 'Pot pie', 'American'), ('Cobb salad', 'Cobb salad', 'American'),
    ('Chili', 'Chili con carne', 'American'), ('Corn dog', 'Corn dog', 'American'),
    ('Sloppy joe', 'Sloppy joe', 'American'), ('Onion rings', 'Onion ring', 'American'),
    # Southern / BBQ
    ('Fried chicken', 'Fried chicken', 'Southern'), ('Chicken and waffles', 'Chicken and waffles', 'Southern'),
    ('Biscuits and gravy', 'Biscuits and gravy', 'Southern'), ('Shrimp and grits', 'Shrimp and grits', 'Southern'),
    ('Gumbo', 'Gumbo', 'Southern'), ('Jambalaya', 'Jambalaya', 'Southern'), ('Po\' boy', 'Po\' boy', 'Southern'),
    ('Cornbread', 'Cornbread', 'Southern'), ('Hush puppies', 'Hushpuppy', 'Southern'),
    ('Brisket', 'Brisket', 'BBQ'), ('Pulled pork', 'Pulled pork', 'BBQ'), ('BBQ ribs', 'Pork ribs', 'BBQ'),
    ('Burnt ends', 'Burnt ends', 'BBQ'), ('Smoked sausage', 'Smoked sausage', 'BBQ'),
    # Mexican
    ('Tacos', 'Taco', 'Mexican'), ('Tacos al pastor', 'Al pastor', 'Mexican'), ('Birria', 'Birria', 'Mexican'),
    ('Carne asada', 'Carne asada', 'Mexican'), ('Burrito', 'Burrito', 'Mexican'), ('Quesadilla', 'Quesadilla', 'Mexican'),
    ('Enchiladas', 'Enchilada', 'Mexican'), ('Tamales', 'Tamale', 'Mexican'), ('Pozole', 'Pozole', 'Mexican'),
    ('Chilaquiles', 'Chilaquiles', 'Mexican'), ('Mole poblano', 'Mole poblano', 'Mexican'), ('Guacamole', 'Guacamole', 'Mexican'),
    ('Elote', 'Elote', 'Mexican'), ('Tostadas', 'Tostada (tortilla)', 'Mexican'), ('Chiles rellenos', 'Chile relleno', 'Mexican'),
    ('Nachos', 'Nachos', 'Mexican'), ('Fajitas', 'Fajita', 'Mexican'), ('Sopes', 'Sope', 'Mexican'),
    ('Menudo', 'Menudo (soup)', 'Mexican'), ('Cochinita pibil', 'Cochinita pibil', 'Mexican'), ('Churros', 'Churro', 'Mexican'),
    # Italian
    ('Pizza margherita', 'Pizza Margherita', 'Italian'), ('Neapolitan pizza', 'Neapolitan pizza', 'Italian'),
    ('Carbonara', 'Carbonara', 'Italian'), ('Spaghetti bolognese', 'Spaghetti alla bolognese', 'Italian'),
    ('Lasagna', 'Lasagna', 'Italian'), ('Fettuccine Alfredo', 'Fettuccine Alfredo', 'Italian'), ('Risotto', 'Risotto', 'Italian'),
    ('Gnocchi', 'Gnocchi', 'Italian'), ('Ravioli', 'Ravioli', 'Italian'), ('Cacio e pepe', 'Cacio e pepe', 'Italian'),
    ('Pesto pasta', 'Pesto', 'Italian'), ('Osso buco', 'Ossobuco', 'Italian'), ('Chicken parmesan', 'Chicken parmigiana', 'Italian'),
    ('Eggplant parmesan', 'Parmigiana', 'Italian'), ('Bruschetta', 'Bruschetta', 'Italian'), ('Arancini', 'Arancini', 'Italian'),
    ('Caprese salad', 'Caprese salad', 'Italian'), ('Calzone', 'Calzone', 'Italian'), ('Focaccia', 'Focaccia', 'Italian'),
    ('Tiramisu', 'Tiramisu', 'Italian'), ('Cannoli', 'Cannoli', 'Italian'), ('Gelato', 'Gelato', 'Italian'),
    ('Panna cotta', 'Panna cotta', 'Italian'), ('Minestrone', 'Minestrone', 'Italian'),
    # Japanese
    ('Sushi', 'Sushi', 'Japanese'), ('Nigiri', 'Nigirizushi', 'Japanese'), ('Sashimi', 'Sashimi', 'Japanese'),
    ('Ramen', 'Ramen', 'Japanese'), ('Tonkotsu ramen', 'Tonkotsu ramen', 'Japanese'), ('Udon', 'Udon', 'Japanese'),
    ('Soba', 'Soba', 'Japanese'), ('Tempura', 'Tempura', 'Japanese'), ('Tonkatsu', 'Tonkatsu', 'Japanese'),
    ('Katsu curry', 'Japanese curry', 'Japanese'), ('Gyoza', 'Gyoza', 'Japanese'), ('Takoyaki', 'Takoyaki', 'Japanese'),
    ('Okonomiyaki', 'Okonomiyaki', 'Japanese'), ('Yakitori', 'Yakitori', 'Japanese'), ('Donburi', 'Donburi', 'Japanese'),
    ('Gyudon', 'Gyūdon', 'Japanese'), ('Katsudon', 'Katsudon', 'Japanese'), ('Onigiri', 'Onigiri', 'Japanese'),
    ('Miso soup', 'Miso soup', 'Japanese'), ('Mochi', 'Mochi', 'Japanese'), ('Matcha', 'Matcha', 'Japanese'),
    # Chinese
    ('Dumplings', 'Jiaozi', 'Chinese'), ('Xiaolongbao', 'Xiaolongbao', 'Chinese'), ('Dim sum', 'Dim sum', 'Chinese'),
    ('Har gow', 'Har gow', 'Chinese'), ('Siu mai', 'Shumai', 'Chinese'), ('Char siu', 'Char siu', 'Chinese'),
    ('Peking duck', 'Peking duck', 'Chinese'), ('Kung pao chicken', 'Kung Pao chicken', 'Chinese'), ('Mapo tofu', 'Mapo tofu', 'Chinese'),
    ('Chow mein', 'Chow mein', 'Chinese'), ('Lo mein', 'Lo mein', 'Chinese'), ('Fried rice', 'Fried rice', 'Chinese'),
    ('Hot pot', 'Hot pot', 'Chinese'), ('Dan dan noodles', 'Dandan noodles', 'Chinese'), ('Sweet and sour pork', 'Sweet and sour pork', 'Chinese'),
    ('General Tso\'s chicken', 'General Tso\'s chicken', 'Chinese'), ('Orange chicken', 'Orange chicken', 'Chinese'),
    ('Spring rolls', 'Spring roll', 'Chinese'), ('Wonton soup', 'Wonton', 'Chinese'), ('Bao buns', 'Baozi', 'Chinese'),
    ('Scallion pancakes', 'Scallion pancake', 'Chinese'), ('Egg tart', 'Egg tart', 'Chinese'), ('Congee', 'Congee', 'Chinese'),
    # Korean
    ('Korean BBQ', 'Korean barbecue', 'Korean'), ('Bulgogi', 'Bulgogi', 'Korean'), ('Galbi', 'Galbi', 'Korean'),
    ('Bibimbap', 'Bibimbap', 'Korean'), ('Korean fried chicken', 'Korean fried chicken', 'Korean'), ('Tteokbokki', 'Tteok-bokki', 'Korean'),
    ('Japchae', 'Japchae', 'Korean'), ('Kimchi jjigae', 'Kimchi-jjigae', 'Korean'), ('Kimchi', 'Kimchi', 'Korean'),
    ('Kimbap', 'Gimbap', 'Korean'), ('Sundubu jjigae', 'Sundubu-jjigae', 'Korean'), ('Naengmyeon', 'Naengmyeon', 'Korean'),
    ('Jajangmyeon', 'Jajangmyeon', 'Korean'), ('Haemul pajeon', 'Pajeon', 'Korean'),
    # Thai
    ('Pad thai', 'Pad thai', 'Thai'), ('Green curry', 'Green curry', 'Thai'), ('Red curry', 'Red curry', 'Thai'),
    ('Massaman curry', 'Massaman curry', 'Thai'), ('Tom yum', 'Tom yum', 'Thai'), ('Tom kha gai', 'Tom kha kai', 'Thai'),
    ('Pad see ew', 'Pad see ew', 'Thai'), ('Pad kra pao', 'Phat kaphrao', 'Thai'), ('Khao soi', 'Khao soi', 'Thai'),
    ('Som tam', 'Green papaya salad', 'Thai'), ('Larb', 'Larb', 'Thai'), ('Mango sticky rice', 'Mango sticky rice', 'Thai'),
    ('Satay', 'Satay', 'Thai'), ('Khao man gai', 'Hainanese chicken rice', 'Thai'),
    # Vietnamese
    ('Pho', 'Pho', 'Vietnamese'), ('Banh mi', 'Bánh mì', 'Vietnamese'), ('Bun cha', 'Bún chả', 'Vietnamese'),
    ('Bun bo Hue', 'Bún bò Huế', 'Vietnamese'), ('Goi cuon', 'Gỏi cuốn', 'Vietnamese'), ('Banh xeo', 'Bánh xèo', 'Vietnamese'),
    ('Com tam', 'Cơm tấm', 'Vietnamese'), ('Cao lau', 'Cao lầu', 'Vietnamese'), ('Vietnamese iced coffee', 'Vietnamese iced coffee', 'Vietnamese'),
    # Indian
    ('Butter chicken', 'Butter chicken', 'Indian'), ('Chicken tikka masala', 'Chicken tikka masala', 'Indian'),
    ('Biryani', 'Biryani', 'Indian'), ('Tandoori chicken', 'Tandoori chicken', 'Indian'), ('Naan', 'Naan', 'Indian'),
    ('Samosa', 'Samosa', 'Indian'), ('Palak paneer', 'Palak paneer', 'Indian'), ('Chana masala', 'Chana masala', 'Indian'),
    ('Dal makhani', 'Dal makhani', 'Indian'), ('Rogan josh', 'Rogan josh', 'Indian'), ('Vindaloo', 'Vindaloo', 'Indian'),
    ('Dosa', 'Dosa (food)', 'Indian'), ('Idli', 'Idli', 'Indian'), ('Pav bhaji', 'Pav bhaji', 'Indian'),
    ('Chole bhature', 'Chole bhature', 'Indian'), ('Pani puri', 'Panipuri', 'Indian'), ('Aloo gobi', 'Aloo gobi', 'Indian'),
    ('Korma', 'Korma', 'Indian'), ('Gulab jamun', 'Gulab jamun', 'Indian'), ('Masala chai', 'Masala chai', 'Indian'),
    ('Mango lassi', 'Lassi', 'Indian'), ('Thali', 'Thali', 'Indian'),
    # Middle Eastern / Mediterranean / Greek / Turkish
    ('Shawarma', 'Shawarma', 'Middle Eastern'), ('Falafel', 'Falafel', 'Middle Eastern'), ('Hummus', 'Hummus', 'Middle Eastern'),
    ('Kebab', 'Kebab', 'Middle Eastern'), ('Shish kebab', 'Shish kebab', 'Middle Eastern'), ('Kofta', 'Kofta', 'Middle Eastern'),
    ('Shakshuka', 'Shakshouka', 'Middle Eastern'), ('Tabbouleh', 'Tabbouleh', 'Middle Eastern'), ('Fattoush', 'Fattoush', 'Middle Eastern'),
    ('Baba ghanoush', 'Baba ghanoush', 'Middle Eastern'), ('Manakish', 'Manakish', 'Middle Eastern'), ('Mansaf', 'Mansaf', 'Middle Eastern'),
    ('Baklava', 'Baklava', 'Middle Eastern'), ('Knafeh', 'Knafeh', 'Middle Eastern'),
    ('Gyro', 'Gyros', 'Greek'), ('Souvlaki', 'Souvlaki', 'Greek'), ('Moussaka', 'Moussaka', 'Greek'),
    ('Spanakopita', 'Spanakopita', 'Greek'), ('Greek salad', 'Greek salad', 'Greek'), ('Tzatziki', 'Tzatziki', 'Greek'),
    ('Döner kebab', 'Doner kebab', 'Turkish'), ('Lahmacun', 'Lahmacun', 'Turkish'), ('Pide', 'Pide', 'Turkish'),
    ('Iskender kebab', 'İskender kebap', 'Turkish'), ('Börek', 'Börek', 'Turkish'), ('Turkish delight', 'Turkish delight', 'Turkish'),
    # Spanish / French / European
    ('Paella', 'Paella', 'Spanish'), ('Patatas bravas', 'Patatas bravas', 'Spanish'), ('Tortilla española', 'Spanish omelette', 'Spanish'),
    ('Gazpacho', 'Gazpacho', 'Spanish'), ('Croquetas', 'Croquette', 'Spanish'), ('Jamón ibérico', 'Jamón ibérico', 'Spanish'),
    ('Gambas al ajillo', 'Gambas al ajillo', 'Spanish'), ('Pulpo a la gallega', 'Pulpo a la gallega', 'Spanish'),
    ('Croissant', 'Croissant', 'French'), ('Crêpes', 'Crêpe', 'French'), ('Steak frites', 'Steak frites', 'French'),
    ('Coq au vin', 'Coq au vin', 'French'), ('Boeuf bourguignon', 'Beef bourguignon', 'French'), ('Ratatouille', 'Ratatouille', 'French'),
    ('French onion soup', 'French onion soup', 'French'), ('Croque monsieur', 'Croque monsieur', 'French'), ('Quiche', 'Quiche', 'French'),
    ('Escargots', 'Escargot', 'French'), ('Crème brûlée', 'Crème brûlée', 'French'), ('Macarons', 'Macaron', 'French'),
    ('Éclair', 'Éclair', 'French'), ('Bouillabaisse', 'Bouillabaisse', 'French'), ('Duck confit', 'Confit de canard', 'French'),
    ('Schnitzel', 'Schnitzel', 'German'), ('Bratwurst', 'Bratwurst', 'German'), ('Pretzel', 'Pretzel', 'German'),
    ('Currywurst', 'Currywurst', 'German'), ('Black Forest cake', 'Black Forest gâteau', 'German'),
    ('Fish and chips', 'Fish and chips', 'British'), ('Full English breakfast', 'Full breakfast', 'British'),
    ('Shepherd\'s pie', 'Shepherd\'s pie', 'British'), ('Sunday roast', 'Sunday roast', 'British'), ('Scones', 'Scone', 'British'),
    ('Pierogi', 'Pierogi', 'Eastern European'), ('Borscht', 'Borscht', 'Eastern European'), ('Goulash', 'Goulash', 'Eastern European'),
    ('Beef stroganoff', 'Beef Stroganoff', 'Eastern European'), ('Cevapi', 'Ćevapi', 'Eastern European'),
    # Latin American / Caribbean / African
    ('Ceviche', 'Ceviche', 'Latin American'), ('Lomo saltado', 'Lomo saltado', 'Latin American'), ('Empanadas', 'Empanada', 'Latin American'),
    ('Arepas', 'Arepa', 'Latin American'), ('Pupusas', 'Pupusa', 'Latin American'), ('Feijoada', 'Feijoada', 'Latin American'),
    ('Picanha', 'Picanha', 'Latin American'), ('Pão de queijo', 'Pão de queijo', 'Latin American'), ('Cuban sandwich', 'Cuban sandwich', 'Latin American'),
    ('Ropa vieja', 'Ropa vieja', 'Latin American'), ('Tres leches cake', 'Tres leches cake', 'Latin American'), ('Alfajores', 'Alfajor', 'Latin American'),
    ('Jerk chicken', 'Jerk (cooking)', 'Caribbean'), ('Jamaican patty', 'Jamaican patty', 'Caribbean'), ('Mofongo', 'Mofongo', 'Caribbean'),
    ('Rice and peas', 'Rice and peas', 'Caribbean'), ('Doubles', 'Doubles (food)', 'Caribbean'),
    ('Jollof rice', 'Jollof rice', 'African'), ('Injera', 'Injera', 'African'), ('Doro wat', 'Doro wat', 'African'),
    ('Bobotie', 'Bobotie', 'African'), ('Tagine', 'Tajine', 'African'), ('Couscous', 'Couscous', 'African'),
    ('Suya', 'Suya', 'African'), ('Bunny chow', 'Bunny chow', 'African'), ('Shakshouka', 'Shakshouka', 'African'),
    # Seafood
    ('Grilled salmon', 'Salmon as food', 'Seafood'), ('Shrimp scampi', 'Scampi', 'Seafood'), ('Oysters', 'Oyster', 'Seafood'),
    ('Lobster', 'Lobster', 'Seafood'), ('Crab legs', 'Crab', 'Seafood'), ('Fish tacos', 'Fish taco', 'Seafood'),
    ('Poke bowl', 'Poke (dish)', 'Seafood'), ('Grilled octopus', 'Octopus as food', 'Seafood'), ('Fried calamari', 'Squid as food', 'Seafood'),
    ('Mussels', 'Moules-frites', 'Seafood'), ('Seafood boil', 'Seafood boil', 'Seafood'),
    # Steak
    ('Ribeye steak', 'Rib eye steak', 'Steakhouse'), ('Filet mignon', 'Filet mignon', 'Steakhouse'),
    ('T-bone steak', 'T-bone steak', 'Steakhouse'), ('Prime rib', 'Standing rib roast', 'Steakhouse'),
    # Breakfast / brunch / bakery
    ('Pancakes', 'Pancake', 'Breakfast'), ('Waffles', 'Waffle', 'Breakfast'), ('French toast', 'French toast', 'Breakfast'),
    ('Eggs Benedict', 'Eggs Benedict', 'Breakfast'), ('Omelette', 'Omelette', 'Breakfast'), ('Avocado toast', 'Avocado toast', 'Breakfast'),
    ('Breakfast burrito', 'Breakfast burrito', 'Breakfast'), ('Huevos rancheros', 'Huevos rancheros', 'Breakfast'),
    ('Bagel and lox', 'Lox', 'Breakfast'), ('Acai bowl', 'Açaí na tigela', 'Breakfast'), ('Hash browns', 'Hash browns', 'Breakfast'),
    ('Cinnamon roll', 'Cinnamon roll', 'Bakery'), ('Donuts', 'Doughnut', 'Bakery'), ('Bagel', 'Bagel', 'Bakery'),
    ('Sourdough', 'Sourdough', 'Bakery'), ('Muffins', 'Muffin', 'Bakery'),
    # Desserts / drinks
    ('Cheesecake', 'Cheesecake', 'Dessert'), ('Chocolate cake', 'Chocolate cake', 'Dessert'), ('Apple pie', 'Apple pie', 'Dessert'),
    ('Brownies', 'Chocolate brownie', 'Dessert'), ('Ice cream sundae', 'Sundae', 'Dessert'), ('Banana split', 'Banana split', 'Dessert'),
    ('Key lime pie', 'Key lime pie', 'Dessert'), ('Carrot cake', 'Carrot cake', 'Dessert'), ('Red velvet cake', 'Red velvet cake', 'Dessert'),
    ('Cupcakes', 'Cupcake', 'Dessert'), ('Chocolate chip cookies', 'Chocolate chip cookie', 'Dessert'), ('Pavlova', 'Pavlova (food)', 'Dessert'),
    ('Bubble tea', 'Bubble tea', 'Drinks'), ('Milkshake', 'Milkshake', 'Drinks'), ('Cappuccino', 'Cappuccino', 'Drinks'),
    ('Margarita', 'Margarita', 'Drinks'), ('Horchata', 'Horchata', 'Drinks'),
    # Bowls / salads / healthy
    ('Caesar salad', 'Caesar salad', 'Healthy'), ('Buddha bowl', 'Buddha bowl', 'Healthy'), ('Grain bowl', 'Grain bowl', 'Healthy'),
    ('Quinoa salad', 'Quinoa', 'Healthy'), ('Smoothie bowl', 'Smoothie', 'Healthy'),
]

STOP = re.compile(
    r'(logo|map|menu|sign|board|label|packag|box|carton|wrapper|store|shop|restaurant|stall|vendor|market|festival|'
    r'kitchen|chef|cook(ing)?_|recipe|people|man_|woman|girl|boy|child|portrait|selfie|stamp|poster|advert|ad_|'
    r'diagram|drawing|illustration|painting|svg|icon|cartoon|clipart|screenshot|museum|statue|monument|building|'
    r'street|truck|van|car_|sculpture|toy|lego|plastic|model|replica|wax|machine|factory|ingredients|raw_|frozen|'
    r'can_|bottle|cup_of|mug|tin|jar|bag_|sack|field|farm|plant|tree|leaf|flower|seed|harvest|'
    r'1[89]\d\d|book|page|scan|newspaper|chart|graph|neon|night|party|event|crowd|audience|guests|wedding|'
    r'prepar|making|wrapping|hands?_|hand_|fingers|display|counter|buffet_line|queue|cart|stand_|booth|'
    r'cooking|frying|grill_master|oven|pot_on|wok_on|fire|smoke_|steam_|blur|out_of_focus|close-?up_of_|texture|'
    r'conference|meeting|class|lesson|workshop|competition|contest|award|price|sale|for_sale)', re.I)
FREE = re.compile(r'^(cc0|cc by|cc-by|public domain|pd|attribution)', re.I)


def get(url, params, retries=4):
    q = url + '?' + urllib.parse.urlencode({**params, 'format': 'json', 'formatversion': '2', 'maxlag': '5'})
    for attempt in range(retries):
        try:
            req = urllib.request.Request(q, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.load(resp)
            if data.get('error', {}).get('code') == 'maxlag':
                time.sleep(5); continue
            return data
        except Exception as exc:  # network hiccup: back off and retry
            if attempt == retries - 1:
                print(f'  ! request failed: {exc}', file=sys.stderr)
                return {}
            time.sleep(2 * (attempt + 1))
    return {}


def strip_html(s):
    return html.unescape(re.sub(r'<[^>]+>', '', s or '')).strip()


def photo_record(page, dish, cuisine, lead):
    info = (page.get('imageinfo') or [{}])[0]
    meta = info.get('extmetadata') or {}
    license_name = strip_html(meta.get('LicenseShortName', {}).get('value', ''))
    title = page.get('title', '')
    if info.get('mime') != 'image/jpeg' or not info.get('thumburl'):
        return None
    w, h = info.get('width', 0), info.get('height', 0)
    min_w, min_h = (640, 420) if lead else (900, 600)
    if w < min_w or h < min_h or not (0.62 <= w / max(h, 1) <= 2.0):
        return None
    if not FREE.search(license_name):
        return None
    desc = strip_html(meta.get('ImageDescription', {}).get('value', ''))[:300]
    if not lead and (STOP.search(title.replace(' ', '_')) or STOP.search(desc.replace(' ', '_'))):
        return None
    artist = strip_html(meta.get('Artist', {}).get('value', ''))[:80] or 'Wikimedia Commons'
    return {
        'dish': dish, 'cuisine': cuisine,
        'url': info['thumburl'],
        'credit': artist,
        'license': license_name[:40],
        'page': info.get('descriptionurl', ''),
        'lead': lead,
    }


IMAGEINFO = {'prop': 'imageinfo', 'iiprop': 'url|size|mime|extmetadata', 'iiurlwidth': THUMB_WIDTH,
             'iiextmetadatafilter': 'Artist|LicenseShortName|ImageDescription'}

# Wikipedias whose dish articles we read. A photo used to illustrate the dish
# in several languages almost certainly shows that dish.
LANGS = ['en', 'es', 'fr', 'de', 'it', 'ja', 'pt', 'zh', 'ko', 'ru', 'pl', 'nl', 'vi', 'th', 'tr', 'hi', 'ar', 'sv', 'id', 'uk']


def resolve_items(dishes):
    """English article -> (lead image file, Wikidata item)."""
    out = {}
    for i in range(0, len(dishes), 20):
        batch = dishes[i:i + 20]
        data = get(WIKI, {'action': 'query', 'titles': '|'.join(t for _, t, _ in batch), 'prop': 'pageimages|pageprops',
                          'piprop': 'name', 'ppprop': 'wikibase_item', 'redirects': '1'})
        q = data.get('query', {})
        redirect = {r['from']: r['to'] for r in q.get('redirects', []) + q.get('normalized', [])}
        pages = {p['title']: p for p in q.get('pages', []) if not p.get('missing')}
        for _, title, _ in batch:
            t = title
            for _ in range(3):
                t = redirect.get(t, t)
            page = pages.get(t, {})
            out[title] = (page.get('pageimage'), (page.get('pageprops') or {}).get('wikibase_item'))
    return out


def sitelinks(item_ids):
    """Wikidata item -> {lang: article title} for LANGS."""
    out = {}
    for i in range(0, len(item_ids), 50):
        data = get(WIKIDATA, {'action': 'wbgetentities', 'ids': '|'.join(item_ids[i:i + 50]), 'props': 'sitelinks'})
        for qid, ent in (data.get('entities') or {}).items():
            links = ent.get('sitelinks') or {}
            out[qid] = {lang: links[f'{lang}wiki']['title'] for lang in LANGS if f'{lang}wiki' in links}
    return out


def article_images(lang, titles):
    """Article title -> JPEG files used in it, on one language Wikipedia."""
    api = f'https://{lang}.wikipedia.org/w/api.php'
    out = {}
    for i in range(0, len(titles), 40):
        params = {'action': 'query', 'titles': '|'.join(titles[i:i + 40]), 'prop': 'images', 'imlimit': 'max', 'redirects': '1'}
        while True:
            data = get(api, params)
            q = data.get('query', {})
            back = {}
            for r in q.get('normalized', []) + q.get('redirects', []):
                back[r['to']] = back.get(r['from'], r['from'])
            for page in q.get('pages', []):
                files = [im['title'].split(':', 1)[1] for im in page.get('images', [])
                         if re.search(r'\.jpe?g$', im['title'], re.I)]
                key = back.get(page.get('title'), page.get('title'))
                out.setdefault(key, []).extend(files)
            if 'continue' not in data:
                break
            params = {**params, **data['continue']}
        time.sleep(0.1)
    return out


def file_pages(file_names):
    """Commons file name -> imageinfo page (files local to one wiki are skipped)."""
    pages = {}
    names = list(file_names)
    for i in range(0, len(names), 40):
        data = get(COMMONS, {'action': 'query', 'titles': '|'.join(f'File:{n}' for n in names[i:i + 40]), **IMAGEINFO})
        q = data.get('query', {})
        norm = {r['to']: r['from'] for r in q.get('normalized', [])}
        for page in q.get('pages', []):
            if page.get('missing') or not page.get('imageinfo'):
                continue
            original = norm.get(page['title'], page['title'])
            pages[original.split(':', 1)[1]] = page
            pages[page['title'].split(':', 1)[1]] = page
        time.sleep(0.1)
    return pages


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--per-dish', type=int, default=12)
    ap.add_argument('--out', default='data/food-photos.json')
    args = ap.parse_args()

    seen, dishes = set(), []
    for d in DISHES:
        if d[0].lower() not in seen:
            seen.add(d[0].lower())
            dishes.append(d)

    items = resolve_items(dishes)
    links = sitelinks(sorted({q for _, q in items.values() if q}))
    print(f'{len(links)} dishes linked to Wikidata', flush=True)

    # How many language editions use each file for each dish.
    votes = {label: {} for label, _, _ in dishes}
    qid_to_labels = {}
    for label, title, _ in dishes:
        lead, qid = items.get(title, (None, None))
        if lead and re.search(r'\.jpe?g$', lead, re.I):
            votes[label][lead.replace('_', ' ')] = 100  # the English lead photo always comes first
        if qid:
            qid_to_labels.setdefault(qid, []).append(label)
    for lang in LANGS:
        titles = {per_lang[lang]: qid for qid, per_lang in links.items() if lang in per_lang}
        used = article_images(lang, list(titles))
        for t, files in used.items():
            for label in qid_to_labels.get(titles.get(t), []):
                for f in set(files):
                    f = f.replace('_', ' ')
                    votes[label][f] = votes[label].get(f, 0) + 1
        print(f'  {lang}: {len(used)} articles', flush=True)

    all_files = {f for v in votes.values() for f in v}
    print(f'{len(all_files)} candidate files; fetching details...', flush=True)
    pages = file_pages(all_files)

    photos, seen_urls = [], set()
    for label, _, cuisine in dishes:
        ranked = sorted(votes[label].items(), key=lambda kv: -kv[1])
        picked = []
        for name, score in ranked:
            if len(picked) >= args.per_dish:
                break
            page = pages.get(name)
            if not page:
                continue
            rec = photo_record(page, label, cuisine, score >= 100)
            if rec and rec['url'] not in seen_urls:
                rec['votes'] = min(score, 99)
                seen_urls.add(rec['url'])
                picked.append(rec)
        # A photo only one language edition used was wrong about one time in
        # eight in spot checks; use those only to give a dish at least three.
        strong = [p for p in picked if p['lead'] or p['votes'] >= 2]
        weak = [p for p in picked if p not in strong]
        picked = strong + weak[:max(0, 3 - len(strong))]
        photos += picked
        print(f'{label:28} {len(picked)}', flush=True)

    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump({'source': 'Wikimedia Commons', 'built': time.strftime('%Y-%m-%d'), 'count': len(photos), 'photos': photos},
                  f, ensure_ascii=False, separators=(',', ':'))
    print(f'\n{len(photos)} photos for {len({p["dish"] for p in photos})} dishes -> {args.out}')


if __name__ == '__main__':
    main()
