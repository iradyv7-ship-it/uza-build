"""
UZA Build — demonstration seed data.

Creates:
  * demo accounts for every role (password: uza1234)
  * a Kigali apartment project with real room geometry
  * a finishing-materials catalogue (UZA catalogue + UZA Bulk + local)
  * manufacturers with compliance / lead-time attributes
  * an initial finish schedule so the golden path is immediately explorable
"""
from __future__ import annotations

from . import db, auth

PW = "uza1234"


def seed(reset: bool = True) -> None:
    db.init_db(drop=reset)

    # -- organizations ----------------------------------------------------- #
    uza = db.execute("INSERT INTO organizations(name,kind) VALUES(?,?)", ("UZA Build", "internal"))
    acme = db.execute("INSERT INTO organizations(name,kind) VALUES(?,?)", ("Twiga Ceramics", "manufacturer"))
    lux = db.execute("INSERT INTO organizations(name,kind) VALUES(?,?)", ("Kigali Joinery Co.", "manufacturer"))
    cli = db.execute("INSERT INTO organizations(name,kind) VALUES(?,?)", ("Vision City Residences", "client"))

    # -- users (one per role) --------------------------------------------- #
    ph = auth.hash_password(PW)
    users = [
        ("Aline U.",    "admin@uza.build",       "super_admin",  "Super Admin",       uza),
        ("David M.",    "director@uza.build",    "director",     "Project Director",  uza),
        ("Sophie K.",   "designer@uza.build",    "designer",     "Interior Designer", uza),
        ("Jean-Paul R.","qs@uza.build",          "qs",           "Quantity Surveyor", uza),
        ("Eric N.",     "engineer@uza.build",    "engineer",     "Technical Reviewer",uza),
        ("Grace I.",    "procurement@uza.build", "procurement",  "Procurement Officer",uza),
        ("Yvette T.",   "client@uza.build",      "client",       "Client",            cli),
        ("Twiga Sales", "sales@twiga.co",        "manufacturer", "Account Manager",   acme),
        ("Site Team",   "installer@uza.build",   "installer",    "Site Supervisor",   uza),
    ]
    uid = {}
    for name, email, role, title, org in users:
        i = db.execute(
            "INSERT INTO users(org_id,name,email,password_hash,role,title) VALUES(?,?,?,?,?,?)",
            (org, name, email, ph, role, title),
        )
        uid[role] = i

    # -- manufacturers ----------------------------------------------------- #
    m_twiga = db.execute(
        "INSERT INTO manufacturers(name,country,categories,rating,compliance,lead_time_days,org_id) VALUES(?,?,?,?,?,?,?)",
        ("Twiga Ceramics", "Tanzania", "floor,wall", 4.4, 0.92, 40, acme))
    m_foshan = db.execute(
        "INSERT INTO manufacturers(name,country,categories,rating,compliance,lead_time_days,org_id) VALUES(?,?,?,?,?,?,?)",
        ("Foshan Sunrise Tile", "China", "floor,wall,sanitaryware", 4.1, 0.88, 65, None))
    m_joinery = db.execute(
        "INSERT INTO manufacturers(name,country,categories,rating,compliance,lead_time_days,org_id) VALUES(?,?,?,?,?,?,?)",
        ("Kigali Joinery Co.", "Rwanda", "door,kitchen,wardrobe", 4.6, 0.9, 25, lux))
    m_grohe = db.execute(
        "INSERT INTO manufacturers(name,country,categories,rating,compliance,lead_time_days,org_id) VALUES(?,?,?,?,?,?,?)",
        ("AquaLine Sanitary", "Turkey", "sanitaryware,lighting", 4.2, 0.94, 50, None))
    m_coatings = db.execute(
        "INSERT INTO manufacturers(name,country,categories,rating,compliance,lead_time_days,org_id) VALUES(?,?,?,?,?,?,?)",
        ("Kigali Coatings & Ceilings", "Rwanda", "paint,ceiling,wall", 4.3, 0.9, 14, None))
    m_eastafr = db.execute(
        "INSERT INTO manufacturers(name,country,categories,rating,compliance,lead_time_days,org_id) VALUES(?,?,?,?,?,?,?)",
        ("East Africa Gypsum Works", "Kenya", "ceiling,paint,window,door", 4.0, 0.86, 30, None))

    # -- products (materials library) ------------------------------------- #
    # cols: code,name,category,unit,unit_price,pack_unit,coverage,pack_size,moq,waste_pct,lead_time_days,color,swatch,finish,standards,warranty,manufacturer_id,source,status
    P = [
        # floors
        ("TIL-PORC-6060-BEI","Porcelain 600x600 Beige","floor","m2",23.5,"m2",1.44,1.44,0,0.10,40,"Beige","#d9c7a3","Matte","ISO 13006, PEI IV","10 yr",m_twiga,"uza-catalogue","approved"),
        ("TIL-PORC-6060-GRY","Porcelain 600x600 Charcoal","floor","m2",25.0,"m2",1.44,1.44,0,0.10,40,"Charcoal","#4a4f55","Matte","ISO 13006, PEI IV","10 yr",m_twiga,"uza-catalogue","approved"),
        ("TIL-MARB-8080-WHT","Marble-look 800x800 Carrara","floor","m2",38.0,"m2",1.28,1.28,0,0.12,65,"White","#eceae4","Polished","ISO 13006","10 yr",m_foshan,"uza-catalogue","approved"),
        ("WD-ENG-OAK-190","Engineered Oak Plank","floor","m2",44.0,"m2",2.20,2.20,0,0.08,55,"Natural Oak","#b58b57","Brushed matt","EN 13489","15 yr",None,"uza-bulk","approved"),
        ("VNL-SPC-CLICK","SPC Click Vinyl (UZA Bulk)","floor","m2",17.9,"m2",2.20,2.20,0,0.07,20,"Warm Grey","#a89a88","Wood-grain","EN 649","12 yr",None,"uza-bulk","approved"),
        # walls
        ("TIL-WALL-3060-WHT","Ceramic Wall 300x600 White","wall","m2",16.5,"m2",1.08,1.08,0,0.10,40,"Gloss White","#f4f4f0","Gloss","ISO 13006","5 yr",m_twiga,"uza-catalogue","approved"),
        ("TIL-WALL-3060-SGE","Ceramic Wall 300x600 Sage","wall","m2",18.0,"m2",1.08,1.08,0,0.10,40,"Sage","#9fae94","Satin","ISO 13006","5 yr",m_twiga,"uza-catalogue","approved"),
        # paint
        ("PNT-EMU-PREM-WHT","Premium Emulsion White (2 coats)","paint","m2",4.2,"m2",1.0,1.0,0,0.05,7,"White","#f7f6f2","Matte","ISO 11998","3 yr",None,"local","approved"),
        ("PNT-EMU-PREM-CLAY","Premium Emulsion Clay (2 coats)","paint","m2",4.6,"m2",1.0,1.0,0,0.05,7,"Clay","#cdb7a1","Matte","ISO 11998","3 yr",None,"local","approved"),
        # ceilings
        ("CEIL-GYP-SMOOTH","Gypsum Skimmed Ceiling","ceiling","m2",12.0,"m2",1.0,1.0,0,0.06,14,"White","#fbfbf9","Smooth","ASTM C1396","5 yr",None,"local","approved"),
        ("CEIL-PVC-WHT","PVC Panel Ceiling","ceiling","m2",9.5,"m2",1.0,1.0,0,0.08,20,"White","#f0f2f2","Gloss","-","3 yr",None,"uza-bulk","approved"),
        # doors
        ("DR-FLUSH-OAK","Flush Oak Veneer Door + Frame","door","no",165.0,"set",1.0,1.0,0,0.0,25,"Oak","#a9764a","Veneer","EN 1634","5 yr",m_joinery,"uza-catalogue","approved"),
        ("DR-ALU-GLASS","Aluminium Glazed Door","door","no",320.0,"set",1.0,1.0,0,0.0,35,"Anthracite","#3b3f43","Powder-coat","EN 14351","10 yr",None,"uza-bulk","approved"),
        # kitchen / wardrobe
        ("KIT-MOD-MATT","Modular Kitchen (matt lacquer, per unit)","kitchen","no",2450.0,"set",1.0,1.0,0,0.0,45,"Graphite","#5c6066","Matt lacquer","-","5 yr",m_joinery,"uza-catalogue","approved"),
        ("WR-3DR-OAK","3-Door Wardrobe (oak melamine)","wardrobe","no",890.0,"set",1.0,1.0,0,0.0,35,"Oak","#b58b57","Melamine","-","5 yr",m_joinery,"uza-catalogue","approved"),
        # sanitaryware
        ("SAN-WC-WALL","Wall-hung WC + concealed cistern","sanitaryware","no",245.0,"set",1.0,1.0,0,0.0,50,"White","#ffffff","Ceramic","EN 997","10 yr",m_grohe,"uza-catalogue","approved"),
        ("SAN-BAS-VAN","Vanity basin + mixer","sanitaryware","no",210.0,"set",1.0,1.0,0,0.0,50,"White","#ffffff","Ceramic","EN 200","10 yr",m_grohe,"uza-catalogue","approved"),
        # lighting
        ("LGT-LED-PANEL","LED Recessed Panel 600x600","lighting","no",28.0,"no",1.0,1.0,0,0.0,30,"Neutral 4000K","#fff8e7","-","IEC 60598","3 yr",m_grohe,"uza-bulk","approved"),
        ("LGT-TRACK-BLK","Track Spotlight (black)","lighting","no",34.0,"no",1.0,1.0,0,0.0,30,"Black","#222222","-","IEC 60598","3 yr",None,"uza-bulk","approved"),
        # windows
        ("WIN-ALU-SLID","Aluminium Sliding Window (clear)","window","no",210.0,"set",1.0,1.0,0,0.0,30,"Natural anodised","#c9d4dc","Anodised","EN 14351","10 yr",m_eastafr,"uza-catalogue","approved"),
        ("WIN-ALU-CASE","Aluminium Casement Window (tinted)","window","no",185.0,"set",1.0,1.0,0,0.0,30,"Bronze tint","#8b7d6b","Powder-coat","EN 14351","10 yr",m_eastafr,"uza-catalogue","approved"),
        # extra finishes for style presets
        ("PNT-EMU-PREM-INK","Premium Emulsion Deep Ink (feature, 2 coats)","paint","m2",5.2,"m2",1.0,1.0,0,0.05,7,"Deep Ink","#2e3b4a","Matte","ISO 11998","3 yr",m_coatings,"local","approved"),
        ("CEIL-ACOU-GRID","Acoustic Grid Ceiling 600x600","ceiling","m2",14.5,"m2",1.0,1.0,0,0.06,21,"White","#f5f6f4","Textured","ASTM E1264","5 yr",m_eastafr,"uza-catalogue","approved"),
    ]
    RWF = 1300          # design doc: prices in RWF for the Kigali market
    pid = {}
    for row in P:
        row = list(row)
        row[4] = round(row[4] * RWF)   # unit_price USD -> RWF
        i = db.execute(
            """INSERT INTO products(code,name,category,unit,unit_price,pack_unit,coverage,pack_size,moq,
                waste_pct,lead_time_days,color,swatch,finish,standards,warranty,manufacturer_id,source,status)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", row)
        pid[row[0]] = i

    # -- variants: sizes / colours / dimensions per solution ---------------- #
    V = {
        "TIL-PORC-6060-BEI": [("size","600×600",1.0,None),("size","300×600",0.95,None),("size","800×800",1.18,None),
                               ("color","Beige",1.0,"#d9c7a3"),("color","Ivory",1.0,"#e8dcc3"),("color","Greige",1.02,"#c9bda9")],
        "TIL-PORC-6060-GRY": [("size","600×600",1.0,None),("size","800×800",1.18,None),
                               ("color","Charcoal",1.0,"#4a4f55"),("color","Graphite",1.0,"#5c6066"),("color","Slate",1.03,"#6b7280")],
        "TIL-MARB-8080-WHT": [("size","800×800",1.0,None),("size","600×1200",1.12,None)],
        "WD-ENG-OAK-190":    [("size","190 mm plank",1.0,None),("size","220 mm plank",1.06,None),
                               ("color","Natural Oak",1.0,"#b58b57"),("color","Smoked Oak",1.05,"#8a6a42"),("color","White-oiled",1.04,"#c8ab86")],
        "VNL-SPC-CLICK":     [("color","Warm Grey",1.0,"#a89a88"),("color","Sand",1.0,"#b7a488"),("color","Ash",1.0,"#9b958c")],
        "TIL-WALL-3060-WHT": [("size","300×600",1.0,None),("size","300×900",1.08,None),
                               ("color","Gloss White",1.0,"#f4f4f0"),("color","Bone",1.0,"#ece5d4")],
        "TIL-WALL-3060-SGE": [("color","Sage",1.0,"#9fae94"),("color","Eucalyptus",1.02,"#8da393")],
        "PNT-EMU-PREM-WHT":  [("color","White",1.0,"#f7f6f2"),("color","Mist",1.0,"#e4e4de"),("color","Sky",1.0,"#d7e2e8")],
        "PNT-EMU-PREM-CLAY": [("color","Clay",1.0,"#cdb7a1"),("color","Terracotta",1.02,"#c29078"),("color","Sand",1.0,"#d8c3a5")],
        "DR-FLUSH-OAK":      [("size","800 mm leaf",1.0,None),("size","900 mm leaf",1.05,None),
                               ("color","Oak",1.0,"#a9764a"),("color","Walnut",1.08,"#7a5636"),("color","White",1.0,"#f0efe9")],
        "KIT-MOD-MATT":      [("color","Graphite",1.0,"#5c6066"),("color","Sage",1.02,"#8d9c87"),("color","Cream",1.0,"#e6ddc9")],
    }
    prod_by_code = {r["code"]: r["id"] for r in db.query("SELECT id, code FROM products")}
    for code, vs in V.items():
        for kind, label, factor, swatch in vs:
            db.execute(
                "INSERT INTO product_variants(product_id,kind,label,swatch,price_factor) VALUES(?,?,?,?,?)",
                (prod_by_code[code], kind, label, swatch, factor))

    # -- project ----------------------------------------------------------- #
    proj = db.execute(
        """INSERT INTO projects(code,name,client,location,type,currency,budget,status,language)
           VALUES(?,?,?,?,?,?,?,?,?)""",
        ("UZA-2601", "Vision City Apartment — Unit B4", "Vision City Residences",
         "Kigali, Rwanda", "Residential apartment", "RWF", 88_400_000, "design", "en"))

    # rooms: name, floor, area, perimeter, height, opening deductions, source, confidence
    rooms = [
        ("Living / Dining", "Ground", 32.0, 24.0, 2.9, 9.5, "drawing-extracted", 0.9),
        ("Kitchen",         "Ground", 11.5, 14.0, 2.9, 4.2, "drawing-extracted", 0.88),
        ("Master Bedroom",  "Ground", 18.0, 17.5, 2.9, 6.0, "drawing-extracted", 0.9),
        ("Master Bath",     "Ground", 5.5,  9.5,  2.7, 3.6, "drawing-extracted", 0.82),
        ("Bedroom 2",       "Ground", 14.0, 15.0, 2.9, 5.2, "drawing-extracted", 0.87),
        ("Guest WC",        "Ground", 3.2,  7.2,  2.7, 2.4, "estimated",         0.7),
    ]
    rid = {}
    for r in rooms:
        i = db.execute(
            """INSERT INTO rooms(project_id,name,floor,area_m2,perimeter_m,height_m,opening_area_m2,source,confidence)
               VALUES(?,?,?,?,?,?,?,?,?)""", (proj, *r))
        rid[r[0]] = i

    # -- initial finish schedule (so the studio opens populated) ----------- #
    def sel(room, cat, code, status="coordinated"):
        db.execute(
            """INSERT INTO selections(room_id,category,product_id,status,source,confidence,selected_by)
               VALUES(?,?,?,?,?,?,?)""",
            (rid[room], cat, pid[code], status, "designer-proposed", 0.9, uid["designer"]))

    sel("Living / Dining", "floor", "TIL-PORC-6060-BEI")
    sel("Living / Dining", "paint", "PNT-EMU-PREM-WHT")
    sel("Living / Dining", "ceiling", "CEIL-GYP-SMOOTH")
    sel("Living / Dining", "lighting", "LGT-LED-PANEL")
    sel("Kitchen", "floor", "TIL-PORC-6060-GRY")
    sel("Kitchen", "wall", "TIL-WALL-3060-WHT")
    sel("Kitchen", "kitchen", "KIT-MOD-MATT")
    sel("Master Bedroom", "floor", "WD-ENG-OAK-190")
    sel("Master Bedroom", "paint", "PNT-EMU-PREM-CLAY")
    sel("Master Bedroom", "wardrobe", "WR-3DR-OAK")
    sel("Master Bath", "floor", "TIL-MARB-8080-WHT")
    sel("Master Bath", "wall", "TIL-WALL-3060-SGE")
    sel("Master Bath", "sanitaryware", "SAN-WC-WALL")
    sel("Bedroom 2", "floor", "VNL-SPC-CLICK")
    sel("Bedroom 2", "paint", "PNT-EMU-PREM-WHT")
    sel("Guest WC", "floor", "TIL-PORC-6060-GRY")
    sel("Guest WC", "sanitaryware", "SAN-BAS-VAN")

    # -- an AI drawing-intelligence run (labelled, with confidence) -------- #
    db.execute(
        """INSERT INTO ai_runs(project_id,kind,prompt,model,output,confidence,source)
           VALUES(?,?,?,?,?,?,?)""",
        (proj, "drawing-intel", "Classify + extract rooms from Unit B4 architectural set",
         "uza-vision-adapter (demo)",
         "Detected 6 rooms, 3 wet areas. Scale 1:50 confirmed. 2 dimension conflicts flagged for QS review.",
         0.84, "drawing-extracted"))

    db.audit(proj, uid["director"], "project.created", "Seeded demo project UZA-2601")
    print(f"Seeded project UZA-2601 with {len(rooms)} rooms, {len(P)} products, {len(users)} users.")


if __name__ == "__main__":
    seed()
