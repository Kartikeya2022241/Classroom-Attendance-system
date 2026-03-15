from sqlalchemy import create_engine, Column, Integer, String, ForeignKey, Table, DateTime, UniqueConstraint
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime

Base = declarative_base()

# Many-to-Many: Students/Professors enrolled in Courses
# UniqueConstraint prevents duplicate enrollment rows when append() is called multiple times
enrollment_table = Table('enrollments', Base.metadata,
    Column('student_id', Integer, ForeignKey('users.id')),
    Column('course_id', Integer, ForeignKey('courses.id')),
    UniqueConstraint('student_id', 'course_id', name='uq_enrollment')
)

class University(Base):
    __tablename__ = 'universities'
    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True)
    courses = relationship("Course", back_populates="university")

class User(Base):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True)
    username = Column(String, unique=True)
    email = Column(String, unique=True)
    password_hash = Column(String)
    role = Column(String)  # "hq_admin", "uni_admin", "professor", "student"
    roll_no = Column(String, nullable=True) # Used for ML matching
    university_id = Column(Integer, ForeignKey('universities.id'))
    courses = relationship("Course", secondary=enrollment_table, overlaps="courses")

class Course(Base):
    __tablename__ = 'courses'
    __table_args__ = (UniqueConstraint('course_code', 'university_id', name='uq_course_per_uni'),)
    id = Column(Integer, primary_key=True)
    course_code = Column(String)
    university_id = Column(Integer, ForeignKey('universities.id'))
    university = relationship("University", back_populates="courses")
    attendance_sessions = relationship("AttendanceSession", back_populates="course")

class AttendanceSession(Base):
    __tablename__ = 'attendance_sessions'
    id = Column(Integer, primary_key=True)
    course_id = Column(Integer, ForeignKey('courses.id'))
    date = Column(DateTime, default=datetime.utcnow)
    course = relationship("Course", back_populates="attendance_sessions")
    records = relationship("AttendanceRecord", back_populates="session")

class AttendanceRecord(Base):
    __tablename__ = 'attendance_records'
    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey('attendance_sessions.id'))
    student_id = Column(Integer, ForeignKey('users.id'))
    status = Column(String, default="PRESENT")
    session = relationship("AttendanceSession", back_populates="records")

engine = create_engine('sqlite:///attendance_system.db')
Base.metadata.create_all(engine)
SessionLocal = sessionmaker(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()