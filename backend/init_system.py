from database import SessionLocal, User
from auth import hash_password

def seed_hq_admin():
    db = SessionLocal()
    if not db.query(User).filter(User.username == "admin").first():
        admin = User(
            username="admin",
            password_hash=hash_password("hq_pass_123"),
            role="hq_admin"
        )
        db.add(admin)
        db.commit()
        print("✅ HQ Admin created: user='admin', pass='hq_pass_123'")
    db.close()

if __name__ == "__main__":
    seed_hq_admin()