import React, { useState,useEffect } from 'react';
import { createPortal } from 'react-dom';
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// Add this component above your main App() function in App.jsx
function CustomModal({ isOpen, title, message, onConfirm, onCancel, type = 'alert' }) {
  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="glass-card w-full max-w-sm p-8 rounded-[2rem] border-white/20 shadow-2xl zoom-in">
        <div className="text-cyan-400 text-3xl mb-4 text-center">
          <i className={`fas ${type === 'confirm' ? 'fa-exclamation-triangle' : 'fa-info-circle'}`}></i>
        </div>
        <h3 className="text-xl font-bold mb-2 text-center text-white">{title}</h3>
        <p className="text-gray-400 text-center mb-8 text-sm leading-relaxed">{message}</p>
        
        <div className="flex gap-3">
          {type === 'confirm' && (
            <button 
              onClick={onCancel} 
              className="flex-1 bg-white/5 hover:bg-white/10 text-white py-3 rounded-xl font-medium transition-colors"
            >
              Cancel
            </button>
          )}
          <button 
            onClick={onConfirm} 
            className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-black font-bold py-3 rounded-xl transition-transform active:scale-95"
          >
            {type === 'confirm' ? 'Confirm' : 'Got it'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}


// ================================================================
// UNI ADMIN DASHBOARD COMPONENT
// ================================================================
function UniAdminDashboard({ showAlert, showConfirm }) {
  const token = () => localStorage.getItem('token');
  const api = (path, opts = {}) =>
    fetch(`${API_BASE}${path}`, {
      ...opts,
      headers: { 'Authorization': `Bearer ${token()}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });

  // Dashboard state
  const [dashboard, setDashboard] = React.useState(null);
  const [professors, setProfessors] = React.useState([]);
  const [students, setStudents] = React.useState([]);
  const [loading, setLoading] = React.useState(true);

  // Active tab: 'courses' | 'professors' | 'students'
  const [activeTab, setActiveTab] = React.useState('courses');

  // Course detail panel
  const [selectedCourse, setSelectedCourse] = React.useState(null);
  const [courseStudents, setCourseStudents] = React.useState([]);
  const [courseStudentsLoading, setCourseStudentsLoading] = React.useState(false);

  // Bulk upload state
  const [bulkFile, setBulkFile] = React.useState(null);
  const [bulkEnroll, setBulkEnroll] = React.useState(true);
  const [bulkJobId, setBulkJobId] = React.useState(null);
  const [bulkLog, setBulkLog] = React.useState([]);
  const [bulkStatus, setBulkStatus] = React.useState(null); // null | 'running' | 'done' | 'error'
  const [bulkCounts, setBulkCounts] = React.useState(null);
  const bulkPollRef = React.useRef(null);

  // Modals
  const [modal, setModal] = React.useState(null); // 'addCourse' | 'addProfessor' | 'addStudent' | 'assignProf' | 'enrollStudent'

  // Form data
  const [courseForm, setCourseForm] = React.useState({ course_code: '' });
  const [profForm, setProfForm] = React.useState({ username: '', email: '', password: '' });
  const [studentForm, setStudentForm] = React.useState({ username: '', email: '', password: '', roll_no: '' });
  const [assignProfId, setAssignProfId] = React.useState('');
  const [enrollStudentId, setEnrollStudentId] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const fetchAll = async ({ initial = false } = {}) => {
    // Only show full loading screen on the very first mount
    if (initial) setLoading(true);
    try {
      const [dashRes, profRes, studRes] = await Promise.all([
        api('/api/uni/dashboard'),
        api('/api/uni/professors'),
        api('/api/uni/students'),
      ]);
      if (dashRes.ok) setDashboard(await dashRes.json());
      if (profRes.ok) setProfessors(await profRes.json());
      if (studRes.ok) setStudents(await studRes.json());
    } catch (e) {
      showAlert('Network Error', 'Could not reach the server.');
    } finally {
      if (initial) setLoading(false);
    }
  };

  React.useEffect(() => { fetchAll({ initial: true }); }, []);

  const fetchCourseStudents = async (courseId) => {
    setCourseStudentsLoading(true);
    try {
      const res = await api(`/api/uni/courses/${courseId}/students`);
      if (res.ok) setCourseStudents(await res.json());
    } finally {
      setCourseStudentsLoading(false);
    }
  };

  const openCourse = (course) => {
    setSelectedCourse(course);
    fetchCourseStudents(course.id);
  };

  const closePanel = () => {
    setSelectedCourse(null);
    setCourseStudents([]);
    setBulkFile(null);
    setBulkJobId(null);
    setBulkLog([]);
    setBulkStatus(null);
    setBulkCounts(null);
    if (bulkPollRef.current) clearInterval(bulkPollRef.current);
  };

  const closeModal = () => {
    setModal(null);
    setCourseForm({ course_code: '' });
    setProfForm({ username: '', email: '', password: '' });
    setStudentForm({ username: '', email: '', password: '', roll_no: '' });
    setAssignProfId('');
    setEnrollStudentId('');
  };

  // --- Actions ---
  const handleAddCourse = async (e) => {
    e.preventDefault(); setSubmitting(true);
    try {
      const res = await api('/api/uni/courses', { method: 'POST', body: JSON.stringify(courseForm) });
      const data = await res.json();
      if (res.ok) {
        closeModal();
        // Optimistically add the new course to the dashboard immediately
        setDashboard(prev => prev ? {
          ...prev,
          courses: [...(prev.courses || []), {
            id: data.id,
            course_code: data.course_code ?? courseForm.course_code,
            professor: null,
            student_count: 0,
            session_count: 0,
          }],
          stats: { ...prev.stats, total_courses: (prev.stats?.total_courses || 0) + 1 }
        } : prev);
        fetchAll(); // background confirm to sync server state
      }
      else showAlert('Error', data.detail || 'Failed to create course');
    } finally { setSubmitting(false); }
  };

  const handleDeleteCourse = (course) => {
    showConfirm('Delete Course?', `Remove "${course.course_code}" and all its sessions?`, async () => {
      const res = await api(`/api/uni/courses/${course.id}`, { method: 'DELETE' });
      if (res.ok) { closePanel(); fetchAll(); }
      else showAlert('Error', 'Could not delete course');
    });
  };

  const handleAddProfessor = async (e) => {
    e.preventDefault(); setSubmitting(true);
    try {
      const res = await api('/api/uni/professors', { method: 'POST', body: JSON.stringify(profForm) });
      const data = await res.json();
      if (res.ok) {
        closeModal();
        setProfessors(prev => [...prev, data]);
        setDashboard(prev => prev ? {
          ...prev,
          stats: { ...prev.stats, total_professors: (prev.stats?.total_professors || 0) + 1 }
        } : prev);
        fetchAll();
      }
      else showAlert('Error', data.detail || 'Failed to create professor');
    } finally { setSubmitting(false); }
  };

  const handleAddStudent = async (e) => {
    e.preventDefault(); setSubmitting(true);
    try {
      const res = await api('/api/uni/students', { method: 'POST', body: JSON.stringify(studentForm) });
      const data = await res.json();
      if (res.ok) {
        closeModal();
        setStudents(prev => [...prev, data]);
        setDashboard(prev => prev ? {
          ...prev,
          stats: { ...prev.stats, total_students: (prev.stats?.total_students || 0) + 1 }
        } : prev);
        fetchAll();
      }
      else showAlert('Error', data.detail || 'Failed to create student');
    } finally { setSubmitting(false); }
  };

  const handleDeleteUser = (user) => {
    showConfirm('Remove User?', `Permanently remove "${user.username}"?`, async () => {
      const res = await api(`/api/uni/users/${user.id}`, { method: 'DELETE' });
      if (res.ok) {
        // Optimistically remove from whichever list they're in
        setProfessors(prev => prev.filter(p => p.id !== user.id));
        setStudents(prev => prev.filter(s => s.id !== user.id));
        setDashboard(prev => {
          if (!prev) return prev;
          const isProfessor = user.role === 'professor';
          return { ...prev, stats: { ...prev.stats,
            total_professors: isProfessor ? (prev.stats?.total_professors || 1) - 1 : prev.stats?.total_professors,
            total_students: !isProfessor ? (prev.stats?.total_students || 1) - 1 : prev.stats?.total_students,
          }};
        });
        fetchAll();
      }
      else showAlert('Error', 'Could not remove user');
    });
  };

  // ---- Bulk ZIP Upload ----
  const handleBulkUpload = async () => {
    if (!bulkFile || !selectedCourse) return;
    const formData = new FormData();
    formData.append('file', bulkFile);
    setBulkStatus('running');
    setBulkLog(['Starting upload...']);
    setBulkCounts(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/uni/courses/${selectedCourse.id}/bulk-upload?enroll=${bulkEnroll}`,
        { method: 'POST', headers: { 'Authorization': `Bearer ${token()}` }, body: formData }
      );
      const data = await res.json();
      if (!res.ok) { setBulkStatus('error'); setBulkLog([data.detail || 'Upload failed']); return; }
      setBulkJobId(data.job_id);
      setBulkLog([`Job started: ${data.job_id.slice(0,8)}...`]);
      // Start polling
      bulkPollRef.current = setInterval(async () => {
        try {
          const pollRes = await fetch(`${API_BASE}/api/uni/jobs/${data.job_id}`,
            { headers: { 'Authorization': `Bearer ${token()}` } });
          const pollData = await pollRes.json();
          setBulkLog(pollData.log || []);
          if (pollData.done) {
            clearInterval(bulkPollRef.current);
            setBulkStatus(pollData.status);
            setBulkCounts(pollData.counts);
            if (pollData.status === 'done') {
              fetchAll();
              if (selectedCourse) fetchCourseStudents(selectedCourse.id);
            }
          }
        } catch(e) { /* ignore poll errors */ }
      }, 1200);
    } catch(e) {
      setBulkStatus('error');
      setBulkLog(['Network error: could not reach server.']);
    }
  };

  const handleAssignProfessor = async (e) => {
    e.preventDefault(); setSubmitting(true);
    try {
      const res = await api(`/api/uni/courses/${selectedCourse.id}/assign-professor`, {
        method: 'POST', body: JSON.stringify({ professor_id: parseInt(assignProfId) })
      });
      const data = await res.json();
      if (res.ok) { closeModal(); fetchAll(); openCourse({ ...selectedCourse }); }
      else showAlert('Error', data.detail || 'Failed to assign professor');
    } finally { setSubmitting(false); }
  };

  const handleEnrollStudent = async (e) => {
    e.preventDefault(); setSubmitting(true);
    try {
      const res = await api(`/api/uni/courses/${selectedCourse.id}/enroll-student`, {
        method: 'POST', body: JSON.stringify({ student_id: parseInt(enrollStudentId) })
      });
      const data = await res.json();
      if (res.ok) { closeModal(); fetchCourseStudents(selectedCourse.id); }
      else showAlert('Error', data.detail || 'Failed to enroll student');
    } finally { setSubmitting(false); }
  };

  const handleUnenrollStudent = (student) => {
    showConfirm('Unenroll Student?', `Remove "${student.username}" from this course?`, async () => {
      const res = await api(`/api/uni/courses/${selectedCourse.id}/students/${student.id}`, { method: 'DELETE' });
      if (res.ok) fetchCourseStudents(selectedCourse.id);
    });
  };

  // ---- Shared input class ----
  const inp = "w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-cyan-500 outline-none transition-colors";
  const label = "text-xs font-black text-gray-500 uppercase tracking-widest block mb-2";

  if (loading) return (
    <main className="max-w-7xl mx-auto px-6 py-12 text-center">
      <div className="py-32 text-gray-500 animate-pulse text-lg">Loading university data...</div>
    </main>
  );

  const stats = dashboard?.stats || {};
  const courses = dashboard?.courses || [];
  const uniName = dashboard?.university?.name || 'Your University';

  return (
    <main className="max-w-7xl mx-auto px-6 py-12 animate-in fade-in">

      {/* ── COURSE DETAIL SIDE PANEL ── */}
      {selectedCourse && (
        <div className="fixed inset-0 z-[110] flex justify-end">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={closePanel} />
          <div className="relative z-10 w-full max-w-lg bg-[#060606] border-l border-white/10 h-full overflow-y-auto p-8 animate-in slide-in-from-right-4">
            {/* Panel Header */}
            <div className="flex justify-between items-start mb-8">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-widest font-black mb-1">Course Detail</p>
                <h3 className="text-3xl font-black text-white">{selectedCourse.course_code}</h3>
              </div>
              <button onClick={closePanel} className="text-gray-500 hover:text-white p-2 rounded-xl hover:bg-white/5 transition-colors">
                <i className="fas fa-times text-lg"></i>
              </button>
            </div>

            {/* Professor Section */}
            <div className="glass-card p-6 rounded-2xl mb-4">
              <div className="flex justify-between items-center mb-4">
                <p className="text-xs font-black text-gray-500 uppercase tracking-widest">Assigned Professor</p>
                <button
                  onClick={() => setModal('assignProf')}
                  className="text-xs bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 px-3 py-1 rounded-lg font-bold transition-colors"
                >
                  {selectedCourse.professor ? 'Reassign' : '+ Assign'}
                </button>
              </div>
              {selectedCourse.professor ? (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-500/20 rounded-xl flex items-center justify-center text-blue-400 font-bold">
                    {selectedCourse.professor.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-white font-bold">{selectedCourse.professor}</p>
                    <p className="text-gray-500 text-xs">Professor</p>
                  </div>
                </div>
              ) : (
                <p className="text-gray-600 text-sm italic">No professor assigned yet.</p>
              )}
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="glass-card p-4 rounded-2xl text-center">
                <p className="text-2xl font-black text-cyan-400">{selectedCourse.student_count}</p>
                <p className="text-xs text-gray-500 uppercase tracking-widest mt-1">Students</p>
              </div>
              <div className="glass-card p-4 rounded-2xl text-center">
                <p className="text-2xl font-black text-purple-400">{selectedCourse.session_count}</p>
                <p className="text-xs text-gray-500 uppercase tracking-widest mt-1">Sessions</p>
              </div>
            </div>

            {/* Enrolled Students */}
            <div className="glass-card p-6 rounded-2xl mb-4">
              <div className="flex justify-between items-center mb-4">
                <p className="text-xs font-black text-gray-500 uppercase tracking-widest">Enrolled Students</p>
                <button
                  onClick={() => setModal('enrollStudent')}
                  className="text-xs bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 px-3 py-1 rounded-lg font-bold transition-colors"
                >
                  + Enroll
                </button>
              </div>
              {courseStudentsLoading ? (
                <p className="text-gray-600 text-sm animate-pulse">Loading...</p>
              ) : courseStudents.length === 0 ? (
                <p className="text-gray-600 text-sm italic">No students enrolled.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {courseStudents.map(s => (
                    <div key={s.id} className="flex items-center justify-between p-3 bg-white/5 rounded-xl group">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-purple-500/20 rounded-lg flex items-center justify-center text-purple-400 text-xs font-bold">
                          {s.username.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-white text-sm font-bold">{s.username}</p>
                          {s.roll_no && <p className="text-gray-500 text-xs">{s.roll_no}</p>}
                        </div>
                      </div>
                      <button
                        onClick={() => handleUnenrollStudent(s)}
                        className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded transition-all"
                      >
                        <i className="fas fa-user-minus"></i>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Bulk Student ZIP Upload */}
            <div className="glass-card p-6 rounded-2xl mb-4">
              <div className="flex justify-between items-center mb-4">
                <p className="text-xs font-black text-gray-500 uppercase tracking-widest">
                  <i className="fas fa-database mr-2 text-cyan-400"></i>Bulk Student Upload
                </p>
                {bulkStatus === 'done' && (
                  <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded-lg font-bold">
                    ✅ Complete
                  </span>
                )}
                {bulkStatus === 'error' && (
                  <span className="text-xs bg-red-500/20 text-red-400 px-2 py-1 rounded-lg font-bold">
                    ❌ Failed
                  </span>
                )}
                {bulkStatus === 'running' && (
                  <span className="text-xs bg-cyan-500/20 text-cyan-400 px-2 py-1 rounded-lg font-bold animate-pulse">
                    <i className="fas fa-spinner fa-spin mr-1"></i>Processing...
                  </span>
                )}
              </div>

              <p className="text-gray-600 text-xs mb-4 leading-relaxed">
                Upload a <span className="text-white font-bold">.zip</span> of student face images.
                File names must follow <span className="text-cyan-400 font-mono">rollno_anything.jpg</span> format.
              </p>

              {/* File picker */}
              {bulkStatus !== 'running' && (
                <label className={`flex items-center gap-3 border-2 border-dashed rounded-xl px-4 py-3 cursor-pointer transition-colors mb-3 ${
                  bulkFile ? 'border-cyan-500/60 bg-cyan-500/5' : 'border-white/10 hover:border-white/25'
                }`}>
                  <input type="file" accept=".zip" className="hidden"
                    onChange={e => { setBulkFile(e.target.files[0] || null); setBulkStatus(null); setBulkLog([]); setBulkCounts(null); }} />
                  <i className={`fas ${bulkFile ? 'fa-file-archive text-cyan-400' : 'fa-upload text-gray-600'} text-lg`}></i>
                  <span className={`text-sm font-bold truncate ${bulkFile ? 'text-cyan-300' : 'text-gray-500'}`}>
                    {bulkFile ? bulkFile.name : 'Choose ZIP file...'}
                  </span>
                  {bulkFile && (
                    <span className="ml-auto text-gray-600 text-xs whitespace-nowrap">
                      {(bulkFile.size / 1024).toFixed(0)} KB
                    </span>
                  )}
                </label>
              )}

              {/* Options */}
              {bulkStatus !== 'running' && (
                <label className="flex items-center gap-3 mb-4 cursor-pointer group">
                  <div
                    onClick={() => setBulkEnroll(v => !v)}
                    className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 ${bulkEnroll ? 'bg-cyan-500' : 'bg-white/10'}`}
                  >
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${bulkEnroll ? 'translate-x-5' : 'translate-x-0.5'}`}></div>
                  </div>
                  <span className="text-sm text-gray-400 group-hover:text-white transition-colors">
                    Auto-create student accounts &amp; enroll in this course
                  </span>
                </label>
              )}

              {/* Upload button */}
              {bulkFile && bulkStatus !== 'running' && bulkStatus !== 'done' && (
                <button
                  onClick={handleBulkUpload}
                  className="w-full bg-cyan-500 hover:bg-cyan-400 text-black font-black py-3 rounded-xl transition-all active:scale-95 text-sm"
                >
                  <i className="fas fa-bolt mr-2"></i>Process ZIP &amp; Build Database
                </button>
              )}

              {/* Re-upload button after done */}
              {bulkStatus === 'done' && (
                <button
                  onClick={() => { setBulkFile(null); setBulkStatus(null); setBulkLog([]); setBulkCounts(null); }}
                  className="w-full bg-white/5 hover:bg-white/10 text-white font-bold py-2 rounded-xl transition-all text-sm"
                >
                  <i className="fas fa-redo mr-2 text-xs"></i>Upload Another ZIP
                </button>
              )}

              {/* Summary counts */}
              {bulkCounts && (
                <div className="grid grid-cols-2 gap-2 mt-3">
                  {[
                    { label: 'Images', val: bulkCounts.total_images, color: 'text-white' },
                    { label: 'Embedded', val: bulkCounts.embedded, color: 'text-cyan-400' },
                    { label: 'Skipped', val: bulkCounts.skipped, color: 'text-yellow-400' },
                    { label: 'Enrolled', val: bulkCounts.students_enrolled, color: 'text-emerald-400' },
                  ].map((s, i) => (
                    <div key={i} className="bg-white/5 rounded-xl px-3 py-2 text-center">
                      <p className={`text-lg font-black ${s.color}`}>{s.val}</p>
                      <p className="text-gray-600 text-[10px] uppercase tracking-widest">{s.label}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Live log terminal */}
              {bulkLog.length > 0 && (
                <div className="mt-3 bg-black/60 rounded-xl p-3 max-h-44 overflow-y-auto border border-white/5">
                  {bulkLog.map((line, i) => (
                    <p key={i} className={`font-mono text-[11px] leading-relaxed whitespace-pre-wrap ${
                      line.includes('❌') ? 'text-red-400' :
                      line.includes('✅') || line.includes('Done') ? 'text-emerald-400' :
                      line.includes('⚠️') ? 'text-yellow-400' :
                      line.includes('💾') ? 'text-cyan-400' :
                      'text-gray-400'
                    }`}>{line}</p>
                  ))}
                </div>
              )}
            </div>

            {/* Danger Zone */}
            <button
              onClick={() => handleDeleteCourse(selectedCourse)}
              className="w-full border border-red-500/30 text-red-400 hover:bg-red-500/10 py-3 rounded-xl font-bold transition-colors text-sm"
            >
              <i className="fas fa-trash-alt mr-2"></i> Delete Course
            </button>
          </div>
        </div>
      )}

      {/* ── MODALS ── */}
      {modal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
          <div className="glass-card w-full max-w-md p-8 rounded-[2rem] border-white/20 animate-in zoom-in">

            {/* Add Course */}
            {modal === 'addCourse' && (
              <>
                <h3 className="text-xl font-black text-white mb-6">
                  <i className="fas fa-book-open text-cyan-400 mr-3"></i>New Course
                </h3>
                <form onSubmit={handleAddCourse} className="space-y-4">
                  <div>
                    <label className={label}>Course Code</label>
                    <input className={inp} placeholder="e.g. CS-301" value={courseForm.course_code}
                      onChange={e => setCourseForm({ course_code: e.target.value })} required />
                  </div>
                  <ModalButtons submitting={submitting} onCancel={closeModal} label="Create Course" />
                </form>
              </>
            )}

            {/* Add Professor */}
            {modal === 'addProfessor' && (
              <>
                <h3 className="text-xl font-black text-white mb-6">
                  <i className="fas fa-chalkboard-teacher text-blue-400 mr-3"></i>Add Professor
                </h3>
                <form onSubmit={handleAddProfessor} className="space-y-4">
                  <div><label className={label}>Username</label>
                    <input className={inp} placeholder="prof_john" value={profForm.username}
                      onChange={e => setProfForm({...profForm, username: e.target.value})} required /></div>
                  <div><label className={label}>Email</label>
                    <input type="email" className={inp} placeholder="john@uni.edu" value={profForm.email}
                      onChange={e => setProfForm({...profForm, email: e.target.value})} required /></div>
                  <div><label className={label}>Initial Password</label>
                    <input type="password" className={inp} placeholder="••••••••" value={profForm.password}
                      onChange={e => setProfForm({...profForm, password: e.target.value})} required /></div>
                  <ModalButtons submitting={submitting} onCancel={closeModal} label="Add Professor" />
                </form>
              </>
            )}

            {/* Add Student */}
            {modal === 'addStudent' && (
              <>
                <h3 className="text-xl font-black text-white mb-6">
                  <i className="fas fa-user-graduate text-purple-400 mr-3"></i>Add Student
                </h3>
                <form onSubmit={handleAddStudent} className="space-y-4">
                  <div><label className={label}>Username</label>
                    <input className={inp} placeholder="stu_alice" value={studentForm.username}
                      onChange={e => setStudentForm({...studentForm, username: e.target.value})} required /></div>
                  <div><label className={label}>Email</label>
                    <input type="email" className={inp} placeholder="alice@uni.edu" value={studentForm.email}
                      onChange={e => setStudentForm({...studentForm, email: e.target.value})} required /></div>
                  <div><label className={label}>Roll No.</label>
                    <input className={inp} placeholder="2024-CS-001" value={studentForm.roll_no}
                      onChange={e => setStudentForm({...studentForm, roll_no: e.target.value})} /></div>
                  <div><label className={label}>Initial Password</label>
                    <input type="password" className={inp} placeholder="••••••••" value={studentForm.password}
                      onChange={e => setStudentForm({...studentForm, password: e.target.value})} required /></div>
                  <ModalButtons submitting={submitting} onCancel={closeModal} label="Add Student" />
                </form>
              </>
            )}

            {/* Assign Professor to Course */}
            {modal === 'assignProf' && (
              <>
                <h3 className="text-xl font-black text-white mb-6">
                  <i className="fas fa-link text-cyan-400 mr-3"></i>Assign Professor
                </h3>
                <p className="text-gray-500 text-sm mb-6">Assigning to <span className="text-white font-bold">{selectedCourse?.course_code}</span></p>
                <form onSubmit={handleAssignProfessor} className="space-y-4">
                  <div>
                    <label className={label}>Select Professor</label>
                    <select className={inp + " cursor-pointer"} value={assignProfId}
                      onChange={e => setAssignProfId(e.target.value)} required>
                      <option value="">-- Choose --</option>
                      {professors.map(p => (
                        <option key={p.id} value={p.id}>{p.username}</option>
                      ))}
                    </select>
                  </div>
                  <ModalButtons submitting={submitting} onCancel={closeModal} label="Assign" />
                </form>
              </>
            )}

            {/* Enroll Student */}
            {modal === 'enrollStudent' && (
              <>
                <h3 className="text-xl font-black text-white mb-6">
                  <i className="fas fa-user-plus text-purple-400 mr-3"></i>Enroll Student
                </h3>
                <p className="text-gray-500 text-sm mb-6">Enrolling into <span className="text-white font-bold">{selectedCourse?.course_code}</span></p>
                <form onSubmit={handleEnrollStudent} className="space-y-4">
                  <div>
                    <label className={label}>Select Student</label>
                    <select className={inp + " cursor-pointer"} value={enrollStudentId}
                      onChange={e => setEnrollStudentId(e.target.value)} required>
                      <option value="">-- Choose --</option>
                      {students.filter(s => !courseStudents.find(cs => cs.id === s.id)).map(s => (
                        <option key={s.id} value={s.id}>{s.username} {s.roll_no ? `(${s.roll_no})` : ''}</option>
                      ))}
                    </select>
                  </div>
                  <ModalButtons submitting={submitting} onCancel={closeModal} label="Enroll" />
                </form>
              </>
            )}

          </div>
        </div>
      )}

      {/* ── PAGE HEADER ── */}
      <div className="flex justify-between items-end mb-10">
        <div>
          <h2 className="text-5xl font-black tracking-tighter text-white">
            UNI <span className="text-cyan-400">COMMAND</span>
          </h2>
          <p className="text-gray-500 font-medium mt-1">{uniName}</p>
        </div>
        <div className="flex gap-3">
          {activeTab === 'courses' && (
            <button onClick={() => setModal('addCourse')}
              className="bg-white text-black hover:bg-cyan-400 hover:scale-105 transition-all duration-300 font-black px-6 py-3 rounded-2xl shadow-xl text-sm">
              + ADD COURSE
            </button>
          )}
          {activeTab === 'professors' && (
            <button onClick={() => setModal('addProfessor')}
              className="bg-blue-500 text-white hover:bg-blue-400 hover:scale-105 transition-all duration-300 font-black px-6 py-3 rounded-2xl shadow-xl text-sm">
              + ADD PROFESSOR
            </button>
          )}
          {activeTab === 'students' && (
            <button onClick={() => setModal('addStudent')}
              className="bg-purple-500 text-white hover:bg-purple-400 hover:scale-105 transition-all duration-300 font-black px-6 py-3 rounded-2xl shadow-xl text-sm">
              + ADD STUDENT
            </button>
          )}
        </div>
      </div>

      {/* ── STAT CARDS ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        {[
          { label: 'Courses', val: stats.total_courses ?? 0, icon: 'fa-book-open', color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
          { label: 'Professors', val: stats.total_professors ?? 0, icon: 'fa-chalkboard-teacher', color: 'text-blue-400', bg: 'bg-blue-500/10' },
          { label: 'Students', val: stats.total_students ?? 0, icon: 'fa-user-graduate', color: 'text-purple-400', bg: 'bg-purple-500/10' },
          { label: 'Sessions Logged', val: stats.total_sessions ?? 0, icon: 'fa-calendar-check', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
        ].map((s, i) => (
          <div key={i} className="glass-card p-6 rounded-2xl flex items-center gap-4">
            <div className={`w-12 h-12 ${s.bg} rounded-xl flex items-center justify-center ${s.color} text-xl flex-shrink-0`}>
              <i className={`fas ${s.icon}`}></i>
            </div>
            <div>
              <p className={`text-2xl font-black ${s.color}`}>{s.val}</p>
              <p className="text-gray-500 text-xs uppercase tracking-widest">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── TABS ── */}
      <div className="flex gap-1 bg-white/5 p-1 rounded-2xl mb-8 w-fit">
        {[
          { key: 'courses', label: 'Courses', icon: 'fa-book-open' },
          { key: 'professors', label: 'Professors', icon: 'fa-chalkboard-teacher' },
          { key: 'students', label: 'Students', icon: 'fa-user-graduate' },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
              activeTab === tab.key ? 'bg-white text-black shadow' : 'text-gray-400 hover:text-white'
            }`}>
            <i className={`fas ${tab.icon}`}></i> {tab.label}
          </button>
        ))}
      </div>

      {/* ── COURSES TAB ── */}
      {activeTab === 'courses' && (
        <div className="grid gap-4">
          {courses.length === 0 ? (
            <div className="py-24 text-center glass-card rounded-[2rem]">
              <i className="fas fa-book-open text-5xl text-gray-700 mb-6 block"></i>
              <p className="text-gray-400 font-bold">No courses yet.</p>
              <p className="text-gray-600 text-sm mt-2">Click <span className="text-cyan-400 font-bold">+ ADD COURSE</span> to get started.</p>
            </div>
          ) : courses.map(course => (
            <div key={course.id}
              onClick={() => openCourse(course)}
              className="glass-card group hover:border-cyan-500/40 transition-all duration-300 p-6 rounded-2xl flex items-center justify-between cursor-pointer">
              <div className="flex items-center gap-5">
                <div className="w-14 h-14 bg-cyan-500/10 rounded-2xl flex items-center justify-center text-cyan-400 text-xl font-black border border-cyan-500/20 group-hover:border-cyan-500/50 transition-colors">
                  <i className="fas fa-book"></i>
                </div>
                <div>
                  <h3 className="text-xl font-black text-white group-hover:text-cyan-400 transition-colors">{course.course_code}</h3>
                  <p className="text-gray-500 text-sm">
                    {course.professor
                      ? <><i className="fas fa-chalkboard-teacher mr-1 text-blue-400"></i>{course.professor}</>
                      : <span className="text-yellow-600 italic">No professor assigned</span>
                    }
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-6 text-right">
                <div className="hidden md:block">
                  <p className="text-lg font-black text-white">{course.student_count}</p>
                  <p className="text-xs text-gray-500 uppercase">Students</p>
                </div>
                <div className="hidden md:block">
                  <p className="text-lg font-black text-white">{course.session_count}</p>
                  <p className="text-xs text-gray-500 uppercase">Sessions</p>
                </div>
                <i className="fas fa-chevron-right text-gray-600 group-hover:text-cyan-400 transition-colors"></i>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── PROFESSORS TAB ── */}
      {activeTab === 'professors' && (
        <div className="grid gap-4">
          {professors.length === 0 ? (
            <div className="py-24 text-center glass-card rounded-[2rem]">
              <i className="fas fa-chalkboard-teacher text-5xl text-gray-700 mb-6 block"></i>
              <p className="text-gray-400 font-bold">No professors yet.</p>
              <p className="text-gray-600 text-sm mt-2">Click <span className="text-blue-400 font-bold">+ ADD PROFESSOR</span> to register one.</p>
            </div>
          ) : professors.map(prof => (
            <div key={prof.id} className="glass-card group hover:border-blue-500/30 transition-all duration-300 p-6 rounded-2xl flex items-center justify-between">
              <div className="flex items-center gap-5">
                <div className="w-12 h-12 bg-blue-500/20 rounded-2xl flex items-center justify-center text-blue-400 font-black text-lg">
                  {prof.username.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-white font-bold">{prof.username}</p>
                  <p className="text-gray-500 text-sm">{prof.email}</p>
                </div>
              </div>
              <button onClick={() => handleDeleteUser(prof)}
                className="opacity-0 group-hover:opacity-100 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-4 py-2 rounded-xl text-sm font-bold transition-all">
                <i className="fas fa-user-minus mr-2"></i>Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── STUDENTS TAB ── */}
      {activeTab === 'students' && (
        <div className="grid gap-4">
          {students.length === 0 ? (
            <div className="py-24 text-center glass-card rounded-[2rem]">
              <i className="fas fa-user-graduate text-5xl text-gray-700 mb-6 block"></i>
              <p className="text-gray-400 font-bold">No students registered.</p>
              <p className="text-gray-600 text-sm mt-2">Click <span className="text-purple-400 font-bold">+ ADD STUDENT</span> to add one.</p>
            </div>
          ) : students.map(stu => (
            <div key={stu.id} className="glass-card group hover:border-purple-500/30 transition-all duration-300 p-6 rounded-2xl flex items-center justify-between">
              <div className="flex items-center gap-5">
                <div className="w-12 h-12 bg-purple-500/20 rounded-2xl flex items-center justify-center text-purple-400 font-black text-lg">
                  {stu.username.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-white font-bold">{stu.username}</p>
                  <p className="text-gray-500 text-sm">{stu.email}</p>
                  {stu.roll_no && <p className="text-gray-600 text-xs font-mono">{stu.roll_no}</p>}
                </div>
              </div>
              <button onClick={() => handleDeleteUser(stu)}
                className="opacity-0 group-hover:opacity-100 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-4 py-2 rounded-xl text-sm font-bold transition-all">
                <i className="fas fa-user-minus mr-2"></i>Remove
              </button>
            </div>
          ))}
        </div>
      )}

    </main>
  );
}

// Shared modal action buttons
function ModalButtons({ submitting, onCancel, label }) {
  return (
    <div className="flex gap-3 pt-2">
      <button type="submit" disabled={submitting}
        className={`flex-1 font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 ${
          submitting ? 'bg-cyan-500/40 text-black/50 cursor-not-allowed' : 'bg-cyan-500 text-black hover:bg-cyan-400'
        }`}>
        {submitting ? <><i className="fas fa-spinner fa-spin"></i> Saving...</> : label}
      </button>
      <button type="button" onClick={onCancel}
        className="flex-1 bg-white/5 text-white py-3 rounded-xl hover:bg-white/10 transition-colors font-bold">
        Cancel
      </button>
    </div>
  );
}


// ================================================================
// PROFESSOR DASHBOARD COMPONENT
// ================================================================
// ═══════════════════════════════════════════════════════════════
// STUDENT DASHBOARD
// ═══════════════════════════════════════════════════════════════
function StudentDashboard({ showAlert, username }) {
  const token = () => localStorage.getItem('token');
  const api = (path, opts = {}) => fetch(`${API_BASE}${path}`, {
    headers: { 'Authorization': `Bearer ${token()}`, ...(opts.headers || {}) },
    ...opts,
  });

  // ── State ──────────────────────────────────────────────────────
  const [overview, setOverview]         = React.useState(null);
  const [loading, setLoading]           = React.useState(true);
  const [activeTab, setActiveTab]       = React.useState('overview'); // overview | courses | classmates
  const [activeCourse, setActiveCourse] = React.useState(null);
  const [sessions, setSessions]         = React.useState([]);
  const [classmates, setClassmates]     = React.useState([]);
  const [sessionsLoading, setSessionsLoading] = React.useState(false);
  const [classmatesLoading, setClassmatesLoading] = React.useState(false);
  const loadedSessionsFor   = React.useRef(null);
  const loadedClassmatesFor = React.useRef(null);

  // ── Load overview on mount ─────────────────────────────────────
  React.useEffect(() => {
    api('/api/student/overview')
      .then(r => r.json())
      .then(d => {
        setOverview(d);
        const firstCourse = d?.courses?.[0];
        if (firstCourse) setActiveCourse(firstCourse);
      })
      .catch(() => showAlert('Error', 'Could not load your dashboard.'))
      .finally(() => setLoading(false));
  }, []);

  // ── Load course-specific data when course or tab changes ───────
  React.useEffect(() => {
    if (!activeCourse) return;
    if (activeTab === 'courses' && loadedSessionsFor.current !== activeCourse.id) {
      setSessionsLoading(true);
      loadedSessionsFor.current = activeCourse.id;
      api(`/api/student/courses/${activeCourse.id}/sessions`)
        .then(r => r.json())
        .then(d => setSessions(Array.isArray(d) ? d : []))
        .finally(() => setSessionsLoading(false));
    }
    if (activeTab === 'classmates' && loadedClassmatesFor.current !== activeCourse.id) {
      setClassmatesLoading(true);
      loadedClassmatesFor.current = activeCourse.id;
      api(`/api/student/courses/${activeCourse.id}/classmates`)
        .then(r => r.json())
        .then(d => setClassmates(Array.isArray(d) ? d : []))
        .finally(() => setClassmatesLoading(false));
    }
  }, [activeCourse, activeTab]);

  // When switching course, clear cached data
  const switchCourse = (course) => {
    if (activeCourse?.id === course.id) return;
    setSessions([]);
    setClassmates([]);
    loadedSessionsFor.current   = null;
    loadedClassmatesFor.current = null;
    setActiveCourse(course);
  };

  // ── Helpers ────────────────────────────────────────────────────
  const pctColor = (p) => p >= 90 ? 'text-emerald-400' : p >= 75 ? 'text-cyan-400' : p >= 50 ? 'text-yellow-400' : 'text-red-400';
  const pctBg    = (p) => p >= 90 ? 'bg-emerald-500/10 border-emerald-500/30' : p >= 75 ? 'bg-cyan-500/10 border-cyan-500/30' : p >= 50 ? 'bg-yellow-500/10 border-yellow-500/30' : 'bg-red-500/10 border-red-500/30';
  const pctBar   = (p) => p >= 90 ? 'bg-emerald-400' : p >= 75 ? 'bg-cyan-400' : p >= 50 ? 'bg-yellow-400' : 'bg-red-400';
  const initials = (name) => name ? name.slice(0, 2).toUpperCase() : 'ST';

  // ── Sessions calendar helpers ──────────────────────────────────
  // Group sessions by month for the timeline view
  const groupByMonth = (sessions) => {
    const groups = {};
    sessions.forEach(s => {
      const month = s.date.slice(0, 7); // "YYYY-MM"
      if (!groups[month]) groups[month] = [];
      groups[month].push(s);
    });
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
  };

  const monthLabel = (ym) => {
    const [y, m] = ym.split('-');
    return new Date(+y, +m - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <i className="fas fa-spinner fa-spin text-5xl text-cyan-400 mb-4 block"></i>
        <p className="text-gray-400 font-bold animate-pulse">Loading your dashboard...</p>
      </div>
    </div>
  );

  if (!overview) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <p className="text-gray-500">Could not load data. Please refresh.</p>
    </div>
  );

  const student  = overview?.student  || { username: '', roll_no: '', email: '' };
  const summary  = overview?.summary  || { total_courses: 0, overall_pct: 0, overall_attended: 0, overall_total: 0, at_risk_count: 0 };
  const courses  = overview?.courses  || [];
  const activeCourseData = courses.find(c => c.id === activeCourse?.id) ?? courses[0] ?? null;

  return (
    <main className="max-w-7xl mx-auto px-6 py-10 animate-in">

      {/* ── Profile Header ──────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 mb-10">
        <div className="flex items-center gap-5">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-2xl font-black text-white shadow-lg shadow-cyan-500/20 flex-shrink-0">
            {initials(student.username)}
          </div>
          <div>
            <h1 className="text-3xl font-black text-white tracking-tight">{student.username}</h1>
            <p className="text-gray-500 text-sm font-medium">
              {student.roll_no && <span className="text-cyan-400 font-bold mr-3">#{student.roll_no}</span>}
              {student.email && <span>{student.email}</span>}
            </p>
          </div>
        </div>
        {/* Overall attendance badge */}
        <div className={`px-5 py-3 rounded-2xl border font-black text-2xl ${pctBg(summary.overall_pct)} ${pctColor(summary.overall_pct)}`}>
          {summary.overall_pct}%
          <span className="text-xs text-gray-500 font-bold ml-2 block text-right">overall</span>
        </div>
      </div>

      {/* ── Summary Stat Strip ──────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { icon: 'fa-book-open',   label: 'Courses',        val: summary.total_courses,    color: 'text-cyan-400',    bg: 'bg-cyan-500/10' },
          { icon: 'fa-check-circle',label: 'Classes Attended',val: summary.overall_attended, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
          { icon: 'fa-times-circle',label: 'Classes Missed',  val: summary.overall_total - summary.overall_attended, color: 'text-red-400', bg: 'bg-red-500/10' },
          { icon: 'fa-exclamation-triangle', label: 'At-Risk Courses', val: summary.at_risk_count, color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
        ].map((s, i) => (
          <div key={i} className={`${s.bg} rounded-2xl p-5 glass-card`}>
            <i className={`fas ${s.icon} ${s.color} text-lg mb-2 block`}></i>
            <p className={`text-2xl font-black ${s.color}`}>{s.val}</p>
            <p className="text-gray-600 text-xs font-bold uppercase tracking-widest mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── Courses Quick Cards ──────────────────────────────────── */}
      {courses.length === 0 ? (
        <div className="glass-card rounded-[2rem] p-16 text-center border border-white/5">
          <i className="fas fa-book text-5xl text-gray-700 mb-4 block"></i>
          <p className="text-gray-400 font-bold text-lg">Not enrolled in any courses yet.</p>
          <p className="text-gray-600 text-sm mt-2">Ask your administrator to enroll you.</p>
        </div>
      ) : (
        <>
          {/* Course selector pills */}
          <div className="flex gap-3 overflow-x-auto pb-2 mb-6 scrollbar-hide">
            {courses.map(c => (
              <button key={c.id}
                onClick={() => switchCourse(c)}
                className={`flex-shrink-0 px-4 py-2 rounded-xl font-bold text-sm transition-all ${
                  activeCourse?.id === c.id
                    ? 'bg-cyan-500 text-black shadow-lg shadow-cyan-500/30'
                    : 'glass-card text-gray-400 hover:text-white hover:border-white/20'
                }`}>
                {c.course_code}
                {c.status === 'AT_RISK' && <span className="ml-2 text-red-400 text-xs">⚠</span>}
              </button>
            ))}
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mb-6 bg-white/3 rounded-2xl p-1 w-fit">
            {[
              { id: 'overview',   icon: 'fa-chart-pie',    label: 'Overview'    },
              { id: 'courses',    icon: 'fa-calendar-alt', label: 'Attendance'  },
              { id: 'classmates', icon: 'fa-users',        label: 'Class'       },
            ].map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all ${
                  activeTab === t.id ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'
                }`}>
                <i className={`fas ${t.icon}`}></i>
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            ))}
          </div>

          {/* ── TAB: OVERVIEW ─────────────────────────────────── */}
          {activeTab === 'overview' && activeCourseData && (
            <div className="grid md:grid-cols-2 gap-6 animate-in">
              {/* Attendance progress card */}
              <div className="glass-card rounded-[2rem] p-8">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <p className="text-xs text-gray-600 uppercase tracking-widest font-black mb-1">Course</p>
                    <h2 className="text-2xl font-black text-white">{activeCourseData.course_code}</h2>
                    <p className="text-gray-500 text-sm mt-1">
                      <i className="fas fa-chalkboard-teacher mr-1.5"></i>{activeCourseData.professor}
                    </p>
                  </div>
                  <div className={`px-4 py-2 rounded-xl border text-sm font-black ${pctBg(activeCourseData.pct)} ${pctColor(activeCourseData.pct)}`}>
                    {activeCourseData.status === 'AT_RISK' ? '⚠ AT RISK' : '✓ ON TRACK'}
                  </div>
                </div>

                {/* Big percentage ring-style display */}
                <div className="flex items-center gap-6 mb-6">
                  <div className={`text-6xl font-black ${pctColor(activeCourseData.pct)}`}>
                    {activeCourseData.pct}%
                  </div>
                  <div className="flex-1">
                    <div className="h-3 bg-white/5 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-700 ${pctBar(activeCourseData.pct)}`}
                        style={{ width: `${activeCourseData.pct}%` }}></div>
                    </div>
                    <div className="flex justify-between mt-2 text-xs text-gray-600 font-bold">
                      <span>{activeCourseData.attended} attended</span>
                      <span>{activeCourseData.absent} missed</span>
                    </div>
                  </div>
                </div>

                {/* Mini stats */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Total',    val: activeCourseData.total_sessions, color: 'text-gray-400' },
                    { label: 'Present',  val: activeCourseData.attended,       color: 'text-emerald-400' },
                    { label: 'Absent',   val: activeCourseData.absent,         color: 'text-red-400' },
                  ].map((s, i) => (
                    <div key={i} className="bg-white/3 rounded-xl p-3 text-center">
                      <p className={`text-xl font-black ${s.color}`}>{s.val}</p>
                      <p className="text-gray-600 text-xs uppercase tracking-widest font-bold mt-0.5">{s.label}</p>
                    </div>
                  ))}
                </div>

                {/* Warning if at risk */}
                {activeCourseData.status === 'AT_RISK' && (
                  <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                    <p className="text-red-400 text-sm font-bold">
                      <i className="fas fa-exclamation-triangle mr-2"></i>
                      Your attendance is below 75%. You need to attend{' '}
                      <span className="text-red-300">
                        {Math.max(0, Math.ceil((0.75 * activeCourseData.total_sessions - activeCourseData.attended) / 0.25))} more
                      </span>{' '}
                      consecutive classes to recover.
                    </p>
                  </div>
                )}
              </div>

              {/* All courses summary list */}
              <div className="glass-card rounded-[2rem] p-8">
                <p className="text-xs text-gray-600 uppercase tracking-widest font-black mb-5">All Courses</p>
                <div className="space-y-4">
                  {courses.map(c => (
                    <button key={c.id} onClick={() => switchCourse(c)}
                      className={`w-full text-left p-4 rounded-2xl transition-all hover:bg-white/5 ${activeCourse?.id === c.id ? 'bg-white/5 border border-white/10' : ''}`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-black text-white text-sm">{c.course_code}</span>
                        <span className={`text-sm font-black ${pctColor(c.pct)}`}>{c.pct}%</span>
                      </div>
                      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-500 ${pctBar(c.pct)}`}
                          style={{ width: `${c.pct}%` }}></div>
                      </div>
                      <div className="flex justify-between mt-1.5 text-xs text-gray-600">
                        <span>{c.attended}/{c.total_sessions} sessions</span>
                        <span className={c.status === 'AT_RISK' ? 'text-red-400 font-bold' : 'text-gray-600'}>
                          {c.status === 'AT_RISK' ? '⚠ AT RISK' : 'ON TRACK'}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── TAB: ATTENDANCE LOG ─────────────────────────────── */}
          {activeTab === 'courses' && (
            <div className="animate-in">
              {sessionsLoading ? (
                <div className="flex items-center justify-center py-20">
                  <i className="fas fa-spinner fa-spin text-4xl text-cyan-400"></i>
                </div>
              ) : sessions.length === 0 ? (
                <div className="glass-card rounded-[2rem] p-16 text-center">
                  <i className="fas fa-calendar-times text-5xl text-gray-700 mb-4 block"></i>
                  <p className="text-gray-500 font-bold">No sessions recorded for this course yet.</p>
                </div>
              ) : (
                <div className="glass-card rounded-[2rem] p-8">
                  {/* Summary strip */}
                  <div className="flex items-center justify-between mb-8">
                    <div>
                      <h3 className="text-xl font-black text-white">{activeCourseData?.course_code} — Attendance Log</h3>
                      <p className="text-gray-500 text-sm mt-1">{sessions.length} total sessions</p>
                    </div>
                    <div className="flex gap-4">
                      <div className="text-center">
                        <p className="text-2xl font-black text-emerald-400">
                          {sessions.filter(s => s.status === 'P').length}
                        </p>
                        <p className="text-xs text-gray-600 uppercase font-bold">Present</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-black text-red-400">
                          {sessions.filter(s => s.status === 'A').length}
                        </p>
                        <p className="text-xs text-gray-600 uppercase font-bold">Absent</p>
                      </div>
                    </div>
                  </div>

                  {/* Month-grouped timeline */}
                  <div className="space-y-6">
                    {groupByMonth(sessions).map(([month, monthSessions]) => (
                      <div key={month}>
                        <p className="text-xs text-gray-600 uppercase tracking-widest font-black mb-3 flex items-center gap-2">
                          <i className="fas fa-calendar text-gray-700"></i>
                          {monthLabel(month)}
                          <span className="ml-auto text-gray-700">
                            {monthSessions.filter(s => s.status === 'P').length}/{monthSessions.length}
                          </span>
                        </p>
                        <div className="grid grid-cols-1 gap-2">
                          {monthSessions.map(s => (
                            <div key={s.session_id}
                              className={`flex items-center justify-between px-4 py-3 rounded-xl ${
                                s.status === 'P'
                                  ? 'bg-emerald-500/8 border border-emerald-500/20'
                                  : 'bg-red-500/8 border border-red-500/20'
                              }`}>
                              <div className="flex items-center gap-3">
                                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                  s.status === 'P' ? 'bg-emerald-400' : 'bg-red-400'
                                }`}></div>
                                <span className="text-gray-300 font-mono text-sm">{s.date}</span>
                              </div>
                              <span className={`text-xs font-black px-3 py-1 rounded-lg ${
                                s.status === 'P'
                                  ? 'bg-emerald-500/20 text-emerald-400'
                                  : 'bg-red-500/20 text-red-400'
                              }`}>
                                {s.status === 'P' ? 'PRESENT' : 'ABSENT'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── TAB: CLASSMATES ─────────────────────────────────── */}
          {activeTab === 'classmates' && (
            <div className="animate-in">
              {classmatesLoading ? (
                <div className="flex items-center justify-center py-20">
                  <i className="fas fa-spinner fa-spin text-4xl text-cyan-400"></i>
                </div>
              ) : classmates.length === 0 ? (
                <div className="glass-card rounded-[2rem] p-16 text-center">
                  <i className="fas fa-users text-5xl text-gray-700 mb-4 block"></i>
                  <p className="text-gray-500 font-bold">No classmates found.</p>
                </div>
              ) : (
                <div className="glass-card rounded-[2rem] p-8">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h3 className="text-xl font-black text-white">{activeCourseData?.course_code} — Class Standing</h3>
                      <p className="text-gray-500 text-sm mt-1">{classmates.length} students enrolled</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-600 font-black uppercase">Your rank</p>
                      <p className="text-2xl font-black text-cyan-400">
                        #{classmates.findIndex(c => c.is_me) + 1}
                        <span className="text-gray-600 text-sm font-bold"> / {classmates.length}</span>
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {classmates.map((c, i) => (
                      <div key={c.roll_no}
                        className={`flex items-center gap-4 px-4 py-3 rounded-xl transition-all ${
                          c.is_me
                            ? 'bg-cyan-500/10 border border-cyan-500/30'
                            : 'bg-white/3 hover:bg-white/5'
                        }`}>
                        {/* Rank */}
                        <span className={`text-sm font-black w-6 text-center flex-shrink-0 ${
                          i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-400' : i === 2 ? 'text-amber-600' : 'text-gray-700'
                        }`}>
                          {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`}
                        </span>
                        {/* Roll No */}
                        <span className={`font-mono text-sm flex-1 font-bold ${c.is_me ? 'text-cyan-400' : 'text-gray-300'}`}>
                          {c.roll_no}
                          {c.is_me && <span className="ml-2 text-xs bg-cyan-500/20 text-cyan-400 px-2 py-0.5 rounded-lg font-black">YOU</span>}
                        </span>
                        {/* Attendance bar */}
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <div className="w-24 h-1.5 bg-white/5 rounded-full overflow-hidden hidden sm:block">
                            <div className={`h-full rounded-full ${pctBar(c.pct)}`}
                              style={{ width: `${c.pct}%` }}></div>
                          </div>
                          <span className={`text-sm font-black w-12 text-right ${pctColor(c.pct)}`}>{c.pct}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}

function ProfessorDashboard({ showAlert, showConfirm, username }) {
  const token = () => localStorage.getItem('token');
  const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';
  const api = (path, opts = {}) =>
    fetch(`${BASE}${path}`, {
      ...opts,
      headers: { 'Authorization': `Bearer ${token()}`, ...(opts.headers || {}) },
    });
  const apiJson = (path, opts = {}) =>
    fetch(`${BASE}${path}`, {
      ...opts,
      headers: { 'Authorization': `Bearer ${token()}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });

  // ── State ──────────────────────────────────────────────────────
  const [courses, setCourses]           = React.useState([]);
  const [activeCourse, setActiveCourse] = React.useState(null);
  const [activeTab, setActiveTab]       = React.useState('capture'); // capture | log | report
  const [loadingCourses, setLoadingCourses] = React.useState(true);

  // Capture tab
  const today = new Date().toISOString().split('T')[0];
  const [sessionDate, setSessionDate]   = React.useState(today);
  const [files, setFiles]               = React.useState([]);          // File[]
  const [processing, setProcessing]     = React.useState(false);
  const [captureResult, setCaptureResult] = React.useState(null);      // last API result
  const fileInputRef = React.useRef(null);

  // Log tab
  const [sessions, setSessions]         = React.useState([]);
  const [loadingSessions, setLoadingSessions] = React.useState(false);
  const [selectedSession, setSelectedSession] = React.useState(null);  // detail panel
  const [sessionDetail, setSessionDetail] = React.useState(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [overrideLoading, setOverrideLoading] = React.useState(false);

  // Report tab
  const [report, setReport]             = React.useState(null);
  const [loadingReport, setLoadingReport] = React.useState(false);
  const [reportFilter, setReportFilter] = React.useState('all');       // all | at_risk | ok

  // ── Fetch courses on mount ──────────────────────────────────────
  React.useEffect(() => {
    api('/api/professor/my-courses')
      .then(r => r.json())
      .then(data => {
        setCourses(Array.isArray(data) ? data : []);
        if (Array.isArray(data) && data.length > 0) setActiveCourse(data[0]);
      })
      .catch(() => showAlert('Error', 'Could not load your courses.'))
      .finally(() => setLoadingCourses(false));
  }, []);

  // ── Fetch sessions/report when course or tab changes ─────────────
  // Track which course ID we last loaded data for
  const loadedForCourseRef = React.useRef(null);
  const skipCaptureResetRef = React.useRef(false); // prevents useEffect wiping captureResult after a recognition run

  React.useEffect(() => {
    if (!activeCourse) return;

    const courseChanged = loadedForCourseRef.current !== activeCourse.id;
    if (courseChanged) {
      // Course switched — clear stale data so we don't show old course's info
      setSessions([]);
      setReport(null);
      loadedForCourseRef.current = activeCourse.id;
    }

    if (activeTab === 'log') {
      // Only fetch if we have no data yet for this course, or course just changed
      if (courseChanged || sessions.length === 0) fetchSessions();
    }
    if (activeTab === 'report') {
      // Only fetch if we have no report yet for this course, or course just changed
      if (courseChanged || !report) fetchReport();
    }
    if (activeTab === 'capture') {
      if (skipCaptureResetRef.current) {
        skipCaptureResetRef.current = false;
      } else if (courseChanged) {
        // Only clear capture state when switching COURSES, not on re-renders
        setCaptureResult(null);
        setFiles([]);
      }
    }
  }, [activeCourse, activeTab]);

  const fetchSessions = async () => {
    if (!activeCourse) return;
    setLoadingSessions(true);
    setSelectedSession(null);
    setSessionDetail(null);
    try {
      const r = await api(`/api/professor/courses/${activeCourse.id}/sessions`);
      const d = await r.json();
      setSessions(Array.isArray(d) ? d : []);
    } finally { setLoadingSessions(false); }
  };

  const fetchReport = async () => {
    if (!activeCourse) return;
    setLoadingReport(true);
    try {
      const r = await api(`/api/professor/courses/${activeCourse.id}/report`);
      const d = await r.json();
      setReport(d);
    } finally { setLoadingReport(false); }
  };

  const fetchSessionDetail = async (session) => {
    setSelectedSession(session);
    setDetailLoading(true);
    setSessionDetail(null);
    try {
      const r = await api(`/api/professor/sessions/${session.session_id}`);
      const d = await r.json();
      setSessionDetail(d);
    } finally { setDetailLoading(false); }
  };

  // ── File handling ───────────────────────────────────────────────
  const handleFileChange = (e) => {
    const newFiles = Array.from(e.target.files || []);
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.name + f.size));
      const unique = newFiles.filter(f => !existing.has(f.name + f.size));
      return [...prev, ...unique];
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (idx) => setFiles(prev => prev.filter((_, i) => i !== idx));

  const handleDrop = (e) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.name + f.size));
      return [...prev, ...dropped.filter(f => !existing.has(f.name + f.size))];
    });
  };

  // ── Process attendance ─────────────────────────────────────────
  const handleProcess = async () => {
    if (!activeCourse || files.length === 0) return;
    if (sessionDate > today) { showAlert('Invalid Date', 'Cannot log attendance for a future date.'); return; }
    setProcessing(true);
    setCaptureResult(null);
    const formData = new FormData();
    formData.append('course_id', activeCourse.id);
    formData.append('session_date', sessionDate);
    files.forEach(f => formData.append('files', f));
    try {
      const r = await api('/api/professor/process-attendance-v2', { method: 'POST', body: formData });
      const d = await r.json();
      if (r.ok) {
        // Show result immediately
        setCaptureResult(d);
        setFiles([]);

        // Set skip flag so the upcoming setActiveCourse call does NOT
        // wipe captureResult via the useEffect
        skipCaptureResetRef.current = true;

        // Refresh courses list (updates session count in stat strip)
        const rc = await api('/api/professor/my-courses');
        const dc = await rc.json();
        if (Array.isArray(dc)) {
          setCourses(dc);
          const updated = dc.find(c => c.id === activeCourse.id);
          if (updated) setActiveCourse(updated);
        }

        // Instantly prepend the new session into the log (no extra fetch needed)
        if (d.session_summary) {
          setSessions(prev => [d.session_summary, ...prev]);
        }

        // Pre-fetch sessions + report in background so switching tabs
        // shows perfectly fresh data (handles edge cases like overwrites)
        const courseId = activeCourse.id;
        api(`/api/professor/courses/${courseId}/sessions`)
          .then(res => res.json())
          .then(data => { if (Array.isArray(data)) setSessions(data); })
          .catch(() => {});
        api(`/api/professor/courses/${courseId}/report`)
          .then(res => res.json())
          .then(data => { if (data && data.students) setReport(data); })
          .catch(() => {});

      } else {
        showAlert('Processing Failed', d.detail || 'Could not process images.');
      }
    } catch (e) {
      showAlert('Network Error', 'Could not reach the server.');
    } finally { setProcessing(false); }
  };

  // ── Override presence ──────────────────────────────────────────
  const handleOverride = async (studentId, makePresent) => {
    if (!selectedSession) return;
    setOverrideLoading(true);
    try {
      const r = await apiJson(`/api/professor/sessions/${selectedSession.session_id}/override`, {
        method: 'PATCH',
        body: JSON.stringify({ student_id: studentId, present: makePresent }),
      });
      if (r.ok) {
        await fetchSessionDetail(selectedSession);
        await fetchSessions();
      } else {
        const d = await r.json();
        showAlert('Override Failed', d.detail || 'Could not update.');
      }
    } finally { setOverrideLoading(false); }
  };

  // ── Download CSV ──────────────────────────────────────────────
  const handleDownloadCSV = async (session) => {
    try {
      const r = await api(`/api/professor/sessions/${session.session_id}/download-csv`);
      if (!r.ok) { showAlert('Download Failed', 'Could not download the CSV.'); return; }
      const blob = await r.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      // Try to pull filename from Content-Disposition header
      const cd   = r.headers.get('Content-Disposition') || '';
      const match = cd.match(/filename="(.+?)"/);
      a.download = match ? match[1] : `attendance_${session.date}.csv`;
      a.href = url;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      showAlert('Network Error', 'Could not reach the server.');
    }
  };

  // ── Helpers ────────────────────────────────────────────────────
  const pctColor = (pct) =>
    pct >= 90 ? 'text-emerald-400' : pct >= 75 ? 'text-cyan-400' : pct >= 50 ? 'text-yellow-400' : 'text-red-400';
  const pctBg = (pct) =>
    pct >= 90 ? 'bg-emerald-500' : pct >= 75 ? 'bg-cyan-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-red-500';

  const filteredReport = React.useMemo(() => {
    if (!report) return [];
    if (reportFilter === 'at_risk') return report.students.filter(s => s.status === 'AT_RISK');
    if (reportFilter === 'ok') return report.students.filter(s => s.status === 'OK');
    return report.students;
  }, [report, reportFilter]);

  if (loadingCourses) return (
    <main className="max-w-7xl mx-auto px-6 py-12 text-center">
      <div className="py-32 text-gray-500 animate-pulse text-lg">Loading your courses...</div>
    </main>
  );

  return (
    <main className="max-w-7xl mx-auto px-6 py-12 animate-in fade-in">

      {/* ── Session Detail Side Panel ─────────────────────────── */}
      {selectedSession && (
        <div className="fixed inset-0 z-[110] flex justify-end">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => { setSelectedSession(null); setSessionDetail(null); }} />
          <div className="relative z-10 w-full max-w-md bg-[#060606] border-l border-white/10 h-full overflow-y-auto p-8 animate-in slide-in-from-right-4">
            <div className="flex justify-between items-start mb-6">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-widest font-black mb-1">Session Detail</p>
                <h3 className="text-2xl font-black text-white">{selectedSession.date}</h3>
                <p className="text-gray-500 text-sm mt-1">
                  <span className="text-emerald-400 font-bold">{selectedSession.present}</span> present ·
                  <span className="text-red-400 font-bold ml-1">{selectedSession.absent}</span> absent ·
                  <span className="text-gray-400 font-bold ml-1">{selectedSession.attendance_pct}%</span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDownloadCSV(selectedSession)}
                  title="Download CSV"
                  className="flex items-center gap-2 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 hover:text-cyan-300 px-3 py-2 rounded-xl font-bold text-xs transition-all"
                >
                  <i className="fas fa-download"></i>
                  <span className="hidden sm:inline">CSV</span>
                </button>
                <button onClick={() => { setSelectedSession(null); setSessionDetail(null); }}
                  className="text-gray-500 hover:text-white p-2 rounded-xl hover:bg-white/5 transition-colors">
                  <i className="fas fa-times text-lg"></i>
                </button>
              </div>
            </div>

            {detailLoading ? (
              <div className="py-20 text-center text-gray-600 animate-pulse">Loading...</div>
            ) : sessionDetail ? (
              <>
                {/* Present */}
                <div className="mb-4">
                  <p className="text-xs font-black text-gray-500 uppercase tracking-widest mb-3">
                    Present ({sessionDetail.present.length})
                  </p>
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {sessionDetail.present.length === 0 && <p className="text-gray-600 text-sm italic">None</p>}
                    {sessionDetail.present.map(s => (
                      <div key={s.id} className="flex items-center justify-between p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-xl group">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-emerald-500/20 rounded-lg flex items-center justify-center text-emerald-400 text-xs font-black">
                            {s.username.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-white text-sm font-bold">{s.username}</p>
                            {s.roll_no && <p className="text-gray-500 text-xs font-mono">{s.roll_no}</p>}
                          </div>
                        </div>
                        <button
                          disabled={overrideLoading}
                          onClick={() => showConfirm('Mark Absent?', `Mark ${s.username} as absent?`, () => handleOverride(s.id, false))}
                          className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded-lg bg-red-500/10 transition-all"
                          title="Mark Absent"
                        >
                          <i className="fas fa-user-minus"></i>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Absent */}
                <div>
                  <p className="text-xs font-black text-gray-500 uppercase tracking-widest mb-3">
                    Absent ({sessionDetail.absent.length})
                  </p>
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {sessionDetail.absent.length === 0 && <p className="text-gray-600 text-sm italic">All present</p>}
                    {sessionDetail.absent.map(s => (
                      <div key={s.id} className="flex items-center justify-between p-3 bg-red-500/5 border border-red-500/20 rounded-xl group">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-red-500/20 rounded-lg flex items-center justify-center text-red-400 text-xs font-black">
                            {s.username.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-white text-sm font-bold">{s.username}</p>
                            {s.roll_no && <p className="text-gray-500 text-xs font-mono">{s.roll_no}</p>}
                          </div>
                        </div>
                        <button
                          disabled={overrideLoading}
                          onClick={() => showConfirm('Mark Present?', `Manually mark ${s.username} as present?`, () => handleOverride(s.id, true))}
                          className="opacity-0 group-hover:opacity-100 text-emerald-400 hover:text-emerald-300 text-xs px-2 py-1 rounded-lg bg-emerald-500/10 transition-all"
                          title="Mark Present"
                        >
                          <i className="fas fa-user-plus"></i>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="mb-10">
        <h2 className="text-5xl font-black tracking-tighter text-white">
          PROF <span className="text-cyan-400">DASHBOARD</span>
        </h2>
        <p className="text-gray-500 font-medium mt-1">Welcome back, <span className="text-white font-bold">{username}</span></p>
      </div>

      {/* ── No courses state ──────────────────────────────────────── */}
      {courses.length === 0 ? (
        <div className="py-32 text-center glass-card rounded-[2rem] border border-white/10">
          <i className="fas fa-chalkboard-teacher text-5xl text-gray-700 mb-6 block"></i>
          <p className="text-gray-400 font-bold text-lg">You have no courses assigned yet.</p>
          <p className="text-gray-600 text-sm mt-2">Ask your university admin to assign you to a course.</p>
        </div>
      ) : (
        <>
          {/* ── Course selector pills ─────────────────────────────── */}
          <div className="flex flex-wrap gap-3 mb-8">
            {courses.map(c => (
              <button key={c.id}
                onClick={() => { setActiveCourse(c); setCaptureResult(null); setFiles([]); setSelectedSession(null); setSessionDetail(null); }}
                className={`px-5 py-2.5 rounded-2xl font-bold text-sm transition-all ${
                  activeCourse?.id === c.id
                    ? 'bg-cyan-500 text-black shadow-lg shadow-cyan-500/20'
                    : 'glass-card text-gray-400 hover:text-white hover:border-white/20'
                }`}>
                <i className="fas fa-book mr-2"></i>{c.course_code}
                <span className={`ml-2 text-xs ${activeCourse?.id === c.id ? 'text-black/60' : 'text-gray-600'}`}>
                  {c.total_students} students
                </span>
              </button>
            ))}
          </div>

          {/* ── Stat strip ───────────────────────────────────────── */}
          {activeCourse && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {[
                { label: 'Course', val: activeCourse.course_code, icon: 'fa-book', color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
                { label: 'Students', val: activeCourse.total_students, icon: 'fa-users', color: 'text-purple-400', bg: 'bg-purple-500/10' },
                { label: 'Sessions Logged', val: activeCourse.total_sessions, icon: 'fa-calendar-check', color: 'text-blue-400', bg: 'bg-blue-500/10' },
                { label: 'Today', val: new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short'}), icon: 'fa-clock', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
              ].map((s, i) => (
                <div key={i} className="glass-card p-5 rounded-2xl flex items-center gap-4">
                  <div className={`w-11 h-11 ${s.bg} rounded-xl flex items-center justify-center ${s.color} text-lg flex-shrink-0`}>
                    <i className={`fas ${s.icon}`}></i>
                  </div>
                  <div>
                    <p className={`text-xl font-black ${s.color}`}>{s.val}</p>
                    <p className="text-gray-500 text-xs uppercase tracking-widest">{s.label}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Tab bar ──────────────────────────────────────────── */}
          <div className="flex gap-1 bg-white/5 p-1 rounded-2xl mb-8 w-fit">
            {[
              { key: 'capture', label: 'Capture', icon: 'fa-camera' },
              { key: 'log',     label: 'Session Log', icon: 'fa-list-alt' },
              { key: 'report',  label: 'Report',  icon: 'fa-chart-bar' },
            ].map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
                  activeTab === tab.key ? 'bg-white text-black shadow' : 'text-gray-400 hover:text-white'
                }`}>
                <i className={`fas ${tab.icon}`}></i>{tab.label}
              </button>
            ))}
          </div>

          {/* ══════════════════════════════════════════════════════
              TAB: CAPTURE
          ══════════════════════════════════════════════════════ */}
          {activeTab === 'capture' && (
            <div className="grid lg:grid-cols-2 gap-6">
              {/* Left: upload area */}
              <div className="glass-card p-8 rounded-[2rem]">
                <h3 className="text-lg font-black text-white mb-6">
                  <i className="fas fa-camera text-cyan-400 mr-3"></i>Upload Classroom Photos
                </h3>

                {/* Date picker */}
                <div className="mb-5">
                  <label className="text-xs font-black text-gray-500 uppercase tracking-widest block mb-2">
                    Session Date
                  </label>
                  <input
                    type="date"
                    value={sessionDate}
                    max={today}
                    onChange={e => setSessionDate(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-cyan-500 outline-none transition-colors cursor-pointer"
                  />
                  {sessionDate < today && (
                    <p className="text-yellow-500 text-xs mt-1.5 font-bold">
                      <i className="fas fa-exclamation-triangle mr-1"></i>Backdating session to {sessionDate}
                    </p>
                  )}
                </div>

                {/* Drop zone */}
                <div
                  onDrop={handleDrop}
                  onDragOver={e => e.preventDefault()}
                  onClick={() => !processing && fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all mb-4 ${
                    processing ? 'border-cyan-500/30 cursor-not-allowed' :
                    files.length > 0 ? 'border-cyan-500/50 bg-cyan-500/5' : 'border-white/10 hover:border-white/30 hover:bg-white/3'
                  }`}
                >
                  <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />
                  <i className={`fas fa-images text-4xl mb-3 block ${files.length > 0 ? 'text-cyan-400' : 'text-gray-700'}`}></i>
                  <p className="font-bold text-white text-sm">
                    {files.length > 0 ? `${files.length} image${files.length > 1 ? 's' : ''} selected` : 'Drop images or click to browse'}
                  </p>
                  <p className="text-gray-600 text-xs mt-1">JPG, PNG, WEBP — multiple files allowed</p>
                </div>

                {/* File list */}
                {files.length > 0 && (
                  <div className="space-y-2 mb-5 max-h-40 overflow-y-auto pr-1">
                    {files.map((f, i) => (
                      <div key={i} className="flex items-center justify-between bg-white/5 rounded-xl px-3 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <i className="fas fa-image text-cyan-400 text-sm flex-shrink-0"></i>
                          <span className="text-white text-sm truncate">{f.name}</span>
                          <span className="text-gray-600 text-xs flex-shrink-0">{(f.size/1024).toFixed(0)}KB</span>
                        </div>
                        {!processing && (
                          <button onClick={() => removeFile(i)} className="text-gray-600 hover:text-red-400 transition-colors ml-2 flex-shrink-0">
                            <i className="fas fa-times text-xs"></i>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Submit */}
                <button
                  onClick={handleProcess}
                  disabled={processing || files.length === 0}
                  className={`w-full font-black py-4 rounded-2xl transition-all flex items-center justify-center gap-3 text-sm ${
                    processing || files.length === 0
                      ? 'bg-white/5 text-gray-600 cursor-not-allowed'
                      : 'bg-cyan-500 text-black hover:bg-cyan-400 hover:scale-[1.02] active:scale-95 shadow-lg shadow-cyan-500/20'
                  }`}
                >
                  {processing ? (
                    <><i className="fas fa-spinner fa-spin"></i> AI Processing {files.length} Image{files.length > 1 ? 's' : ''}...</>
                  ) : (
                    <><i className="fas fa-bolt"></i> Run Attendance Recognition</>
                  )}
                </button>
              </div>

              {/* Right: result */}
              <div className="glass-card p-8 rounded-[2rem] flex flex-col">
                <h3 className="text-lg font-black text-white mb-6">
                  <i className="fas fa-poll text-blue-400 mr-3"></i>Recognition Result
                </h3>

                {!captureResult && !processing && (
                  <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
                    <i className="fas fa-eye text-5xl text-gray-800 mb-4"></i>
                    <p className="text-gray-600 font-bold">No result yet.</p>
                    <p className="text-gray-700 text-sm mt-1">Upload classroom photos and run recognition.</p>
                  </div>
                )}

                {processing && (
                  <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
                    <i className="fas fa-spinner fa-spin text-5xl text-cyan-400 mb-4"></i>
                    <p className="text-cyan-400 font-bold animate-pulse">Detecting faces...</p>
                    <p className="text-gray-600 text-sm mt-1">This may take a moment</p>
                  </div>
                )}

                {captureResult && !processing && (
                  <div className="flex-1 flex flex-col">
                    {/* Summary numbers */}
                    <div className="grid grid-cols-3 gap-3 mb-6">
                      {[
                        { label: 'Images', val: captureResult.images_processed, color: 'text-white', bg: 'bg-white/5' },
                        { label: 'Detected', val: captureResult.total_detected, color: 'text-blue-400', bg: 'bg-blue-500/10' },
                        { label: 'Identified', val: captureResult.total_present, color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
                      ].map((s, i) => (
                        <div key={i} className={`${s.bg} rounded-2xl p-4 text-center`}>
                          <p className={`text-2xl font-black ${s.color}`}>{s.val}</p>
                          <p className="text-gray-500 text-xs uppercase tracking-widest mt-1">{s.label}</p>
                        </div>
                      ))}
                    </div>

                    <p className="text-xs font-black text-gray-500 uppercase tracking-widest mb-3">
                      Present Students ({captureResult.present_rolls.length})
                    </p>
                    {captureResult.present_rolls.length === 0 ? (
                      <p className="text-gray-600 text-sm italic">No students identified. Check image quality or student database.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2 overflow-y-auto flex-1 content-start">
                        {captureResult.present_rolls.map(r => (
                          <span key={r} className="bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 px-3 py-1 rounded-xl text-sm font-mono font-bold">
                            {r}
                          </span>
                        ))}
                      </div>
                    )}

                    <button
                      onClick={() => { setActiveTab('log'); }}
                      className="mt-6 w-full border border-white/10 text-gray-400 hover:text-white hover:border-white/30 py-2.5 rounded-xl font-bold text-sm transition-colors"
                    >
                      <i className="fas fa-list-alt mr-2"></i>View Session Log
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════
              TAB: SESSION LOG
          ══════════════════════════════════════════════════════ */}
          {activeTab === 'log' && (
            <div className="grid gap-3">
              {loadingSessions ? (
                <div className="py-20 text-center text-gray-600 animate-pulse">Loading sessions...</div>
              ) : sessions.length === 0 ? (
                <div className="py-24 text-center glass-card rounded-[2rem]">
                  <i className="fas fa-calendar-times text-5xl text-gray-700 mb-6 block"></i>
                  <p className="text-gray-400 font-bold">No sessions logged yet.</p>
                  <p className="text-gray-600 text-sm mt-2">Upload classroom photos in the Capture tab.</p>
                </div>
              ) : sessions.map(s => {
                const isSelected = selectedSession?.session_id === s.session_id;
                return (
                  <div key={s.session_id}
                    onClick={() => fetchSessionDetail(s)}
                    className={`glass-card group cursor-pointer p-6 rounded-2xl flex items-center justify-between transition-all duration-200 ${
                      isSelected ? 'border-cyan-500/50 bg-cyan-500/5' : 'hover:border-white/20'
                    }`}>
                    <div className="flex items-center gap-5">
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-sm font-black ${
                        isSelected ? 'bg-cyan-500 text-black' : 'bg-white/5 text-gray-400'
                      }`}>
                        <i className="fas fa-calendar-day"></i>
                      </div>
                      <div>
                        <p className="text-white font-black">{new Date(s.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</p>
                        <p className="text-gray-500 text-sm">
                          <span className="text-emerald-400 font-bold">{s.present}</span> present ·
                          <span className="text-red-400 font-bold ml-1">{s.absent}</span> absent
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      {/* Mini attendance bar */}
                      <div className="hidden md:flex items-center gap-3">
                        <div className="w-28 h-2 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${pctBg(s.attendance_pct)}`}
                            style={{ width: `${s.attendance_pct}%` }}
                          ></div>
                        </div>
                        <span className={`text-sm font-black ${pctColor(s.attendance_pct)}`}>{s.attendance_pct}%</span>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDownloadCSV(s); }}
                        title="Download CSV"
                        className="opacity-0 group-hover:opacity-100 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 p-2 rounded-xl transition-all"
                      >
                        <i className="fas fa-download text-sm"></i>
                      </button>
                      <i className="fas fa-chevron-right text-gray-600 group-hover:text-cyan-400 transition-colors"></i>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════
              TAB: REPORT
          ══════════════════════════════════════════════════════ */}
          {activeTab === 'report' && (
            <>
              {loadingReport ? (
                <div className="py-20 text-center text-gray-600 animate-pulse">Generating report...</div>
              ) : !report ? null : (
                <>
                  {/* Summary cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                    {[
                      { label: 'Total Sessions', val: report.total_sessions, color: 'text-white', bg: 'bg-white/5' },
                      { label: 'Total Students', val: report.total_students, color: 'text-purple-400', bg: 'bg-purple-500/10' },
                      { label: 'At Risk (<75%)', val: report.students.filter(s => s.status === 'AT_RISK').length, color: 'text-red-400', bg: 'bg-red-500/10' },
                      { label: 'On Track (≥75%)', val: report.students.filter(s => s.status === 'OK').length, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
                    ].map((s, i) => (
                      <div key={i} className={`${s.bg} glass-card p-5 rounded-2xl text-center`}>
                        <p className={`text-3xl font-black ${s.color}`}>{s.val}</p>
                        <p className="text-gray-500 text-xs uppercase tracking-widest mt-1">{s.label}</p>
                      </div>
                    ))}
                  </div>

                  {/* Filter */}
                  <div className="flex gap-2 mb-5">
                    {[
                      { key: 'all', label: 'All Students' },
                      { key: 'at_risk', label: '⚠ At Risk' },
                      { key: 'ok', label: '✅ On Track' },
                    ].map(f => (
                      <button key={f.key} onClick={() => setReportFilter(f.key)}
                        className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                          reportFilter === f.key ? 'bg-white text-black' : 'glass-card text-gray-400 hover:text-white'
                        }`}>
                        {f.label}
                      </button>
                    ))}
                  </div>

                  {/* Student attendance table */}
                  <div className="glass-card rounded-[2rem] overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-white/10">
                          <th className="text-left px-6 py-4 text-xs font-black text-gray-500 uppercase tracking-widest">Student</th>
                          <th className="text-left px-6 py-4 text-xs font-black text-gray-500 uppercase tracking-widest hidden md:table-cell">Roll No</th>
                          <th className="text-center px-6 py-4 text-xs font-black text-gray-500 uppercase tracking-widest">Attended</th>
                          <th className="text-right px-6 py-4 text-xs font-black text-gray-500 uppercase tracking-widest">Attendance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredReport.length === 0 && (
                          <tr><td colSpan={4} className="py-12 text-center text-gray-600">No students match this filter.</td></tr>
                        )}
                        {filteredReport.map((s, i) => (
                          <tr key={s.student_id}
                            className={`border-b border-white/5 hover:bg-white/3 transition-colors ${
                              s.status === 'AT_RISK' ? 'bg-red-500/3' : ''
                            }`}>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-black flex-shrink-0 ${
                                  s.status === 'AT_RISK' ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'
                                }`}>
                                  {s.username.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                  <p className="text-white font-bold text-sm">{s.username}</p>
                                  {s.status === 'AT_RISK' && (
                                    <span className="text-[10px] text-red-400 font-black uppercase tracking-widest">AT RISK</span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4 hidden md:table-cell">
                              <span className="text-gray-500 font-mono text-sm">{s.roll_no || '—'}</span>
                            </td>
                            <td className="px-6 py-4 text-center">
                              <span className="text-white font-bold">{s.attended}</span>
                              <span className="text-gray-600 text-sm"> / {s.total}</span>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center justify-end gap-3">
                                <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden hidden md:block">
                                  <div className={`h-full rounded-full ${pctBg(s.pct)}`} style={{ width: `${s.pct}%` }}></div>
                                </div>
                                <span className={`font-black text-sm w-12 text-right ${pctColor(s.pct)}`}>{s.pct}%</span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}

export default function App() {
  // const [newUniName, setNewUniName] = useState('');
  const [onboardData, setOnboardData] = useState({
    uni_name: "",
    admin_username: "",
    admin_email: "",
    admin_password: ""
  });
  const [isUniModalOpen, setIsUniModalOpen] = useState(false);
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [view, setView] = useState(localStorage.getItem('role') || 'landing');
  const [userInput, setUserInput] = useState(localStorage.getItem('username') || '');
  const [password, setPassword] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  // const [userInput, setUserInput] = useState('');
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [course, setCourse] = useState('CS-101');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  // Inside your App component
  const [adminStats, setAdminStats] = useState(null);
  const [activeMenuId, setActiveMenuId] = useState(null);

  const [adminSubView, setAdminSubView] = useState('list'); // 'list', 'logs', or 'branding'
  const [selectedUni, setSelectedUni] = useState(null);

  const handleAdminAction = (uni, action) => {
    setSelectedUni(uni);
    setAdminSubView(action);
    setActiveMenuId(null); // Close the dropdown
  };

  // Inside App()
  const [modalConfig, setModalConfig] = useState({ 
    isOpen: false, 
    title: '', 
    message: '', 
    type: 'alert', 
    onConfirm: () => {} 
  });

  // Helper to trigger the modal
  const showAlert = (title, message) => {
    setModalConfig({ isOpen: true, title, message, type: 'alert', onConfirm: () => setModalConfig(prev => ({...prev, isOpen: false})) });
  };

  const showConfirm = (title, message, onConfirmAction) => {
    setModalConfig({ 
      isOpen: true, 
      title, 
      message, 
      type: 'confirm', 
      onConfirm: () => { onConfirmAction(); setModalConfig(prev => ({...prev, isOpen: false})); },
      onCancel: () => setModalConfig(prev => ({...prev, isOpen: false}))
    });
  };

  const handleLogin = async (e) => {
    if (e) e.preventDefault();
    
    const formData = new FormData();
    formData.append('username', userInput);
    formData.append('password', password); // For demo, or add a password state

    try {
      const response = await fetch(`${API_BASE}/api/login`, {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      
      if (response.ok) {
        localStorage.setItem('token', data.access_token);
        localStorage.setItem('role', data.role);
        localStorage.setItem('username', userInput); // Save username for persistence
        setView(data.role);
        setIsAuthOpen(false);
        setPassword('');
      } else {
        showAlert("Access Denied", "The credentials provided do not match our records.");
      }
    } catch (err) {
      showAlert("System Error", "The authentication server is currently unreachable.");
    }
  };

  const handleOnboard = async () => {
    try {
      const response = await fetch("http://127.0.0.1:8000/api/admin/onboard_university", {
        method: "POST",
        headers: {
          "Content-Type": "application/json", // Important: must be JSON now
          "Authorization": `Bearer ${token}`    // Ensure the HQ Admin token is sent
        },
        body: JSON.stringify(onboardData)
      });

      if (response.ok) {
        alert("University and Admin created! Credentials sent via email.");
        // Reset form or close modal here
      } else {
        const error = await response.json();
        alert(`Error: ${error.detail}`);
      }
    } catch (err) {
      console.error("Onboarding error:", err);
    }
  };

  const logout = () => {
    localStorage.clear();
    setView('landing');
    setUserInput('');
    setPassword('');
    setResults(null);
  };

  const processAttendance = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true);
    
    const token = localStorage.getItem('token');
    const formData = new FormData();
    formData.append('file', file);
    // NOTE: This legacy function uses the old v1 endpoint. Use ProfessorDashboard's
    // process-attendance-v2 instead, which correctly uses the selected course ID.
    formData.append('course_id', activeCourse?.id ?? 1); 

    try {
      const response = await fetch(`${API_BASE}/api/professor/upload-attendance`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      const data = await response.json();
      
      if (response.ok) {
        // Backend returns {present_students: [...], total_detected: X}
        setResults({
          detected_count: data.total_detected,
          present_students: data.present_students
        });
      } else {
        showAlert("Analysis Failed", data.detail || "Could not process classroom image.");

      }
    } catch (err) {
      showAlert("Connection Error", "Failed to connect to the attendance processing server.");
    } finally {
      setLoading(false);
    }
  };


  const removeUniversity = async (uniId) => {
    showConfirm(
      "Delete Partner?", 
      "This will permanently remove the university and all associated department records.",
      async () => {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/api/admin/university/${uniId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
          // Optimistically remove from list immediately, then background-confirm
          setAdminStats(prev => Array.isArray(prev) ? prev.filter(u => u.id !== uniId) : prev);
          fetchAdminStats({ silent: true });
        }
      }
    );
  };

  
  const fetchAdminStats = async ({ silent = false } = {}) => {
    // silent=true: don't show syncing indicator (background refresh)
    if (!silent) setIsSyncing(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_BASE}/api/admin/stats`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setAdminStats(data);
    } catch (err) {
      console.error("Sync error:", err);
    } finally {
      setIsSyncing(false); // no artificial delay
    }
  };

  // Trigger fetch when view changes to hq_admin
  useEffect(() => {
    if (view === 'hq_admin') fetchAdminStats();
  }, [view]);

  const onboardUniversity = async (e) => {
    if (e) e.preventDefault();
    const token = localStorage.getItem('token');
    setIsOnboarding(true);

    let response;
    try {
      response = await fetch(`${API_BASE}/api/admin/onboard_university`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(onboardData)
      });
    } catch (networkErr) {
      showAlert("Service Unavailable", "Cannot reach the server. Please check that the backend is running.");
      setIsOnboarding(false);
      return;
    }

    try {
      const data = await response.json();
      if (response.ok) {
        setIsUniModalOpen(false);
        setOnboardData({ uni_name: "", admin_username: "", admin_email: "", admin_password: "" });
        // Background sync — show existing list immediately, update quietly
        fetchAdminStats({ silent: true });
      } else {
        const detail = data.detail;
        const message = Array.isArray(detail)
          ? detail.map(err => err.msg).join(', ')
          : detail || "Unable to register new partner.";
        showAlert("Onboarding Error", message);
      }
    } catch (parseErr) {
      showAlert("Unexpected Error", `Server returned status ${response.status}. Please try again.`);
    } finally {
      setIsOnboarding(false);
    }
  };

  useEffect(() => {
    const savedRole = localStorage.getItem('role');
    if (savedRole) {
      setView(savedRole);
    }
  }, []);

  // Dropdown position is computed via useEffect+rAF so it always fires
  // AFTER the newly-rendered list items are painted in the DOM.
  const [dropdownStyle, setDropdownStyle] = useState({});

  useEffect(() => {
    if (activeMenuId === null) { setDropdownStyle({}); return; }
    const MENU_W = 224, MENU_H = 160, GAP = 8;
    const compute = () => {
      const btn = document.getElementById(`gear-${activeMenuId}`);
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      let top = rect.bottom + GAP;
      if (vh - rect.bottom < MENU_H + GAP) top = rect.top - MENU_H - GAP;
      top = Math.max(GAP, Math.min(top, vh - MENU_H - GAP));
      let left = rect.right - MENU_W;
      left = Math.max(GAP, Math.min(left, vw - MENU_W - GAP));
      setDropdownStyle({ top, left, width: MENU_W });
    };
    const rafId = requestAnimationFrame(compute);
    return () => cancelAnimationFrame(rafId);
  }, [activeMenuId]);

  return (
    <div className="min-h-screen">
      {/* AUTH OVERLAY */}
      {isAuthOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-xl p-6">
          <div className="bg-white text-gray-900 w-full max-w-[800px] rounded-[2rem] overflow-hidden flex shadow-2xl animate-in fade-in zoom-in duration-300">
            
            {/* Left Branding Side */}
            <div className="hidden md:flex w-1/2 bg-gray-900 p-12 flex-col justify-between text-white">
              <div>
                <div className="text-cyan-400 text-3xl mb-6"><i className="fas fa-eye"></i></div>
                <h2 className="text-4xl font-bold leading-tight">Secure <br/>Portal Access</h2>
              </div>
              <p className="text-gray-500 text-sm">Attend-Vision Enterprise v2.0</p>
            </div>

            {/* Right Form Side */}
            <div className="w-full md:w-1/2 p-12 relative">
              <button onClick={() => setIsAuthOpen(false)} className="absolute top-6 right-6 text-gray-400 hover:text-gray-950">
                <i className="fas fa-times"></i>
              </button>
              
              <h3 className="text-2xl font-bold mb-8">Sign In</h3>

              <form onSubmit={handleLogin} className="space-y-5">
                <div>
                  <label className="text-xs font-bold uppercase text-gray-500 mb-2 block">Username</label>
                  <input 
                    type="text" 
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    placeholder="e.g. hq_admin" 
                    /* Added bg-gray-100 and !text-black to ensure visibility */
                    className="w-full bg-gray-100 border-b-2 border-gray-200 px-4 py-3 rounded-t-lg focus:border-cyan-500 outline-none transition-colors !text-black"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-gray-500 mb-2 block">Password</label>
                  <input 
                    type="password" 
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••" 
                    /* Added bg-gray-100 and !text-black to ensure visibility */
                    className="w-full bg-gray-100 border-b-2 border-gray-200 px-4 py-3 rounded-t-lg focus:border-cyan-500 outline-none transition-colors !text-black"
                    required
                  />
                </div>
                
                <button 
                  type="submit" 
                  className="w-full bg-gray-900 text-white font-bold py-4 rounded-xl hover:bg-gray-800 transition-all shadow-lg mt-4"
                >
                  Access Dashboard
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* NAVBAR */}
      <nav className="sticky top-0 z-50 backdrop-blur-md border-b border-white/10 px-6 py-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div onClick={logout} className="text-2xl font-black tracking-tight flex items-center gap-2 cursor-pointer">
            <i className="fas fa-eye text-cyan-400"></i> Attend-Vision
          </div>
          
          {view === 'landing' && (
            <div className="hidden md:flex gap-8 text-sm font-medium">
              <a href="#how-it-works" className="nav-link transition">How it Works</a>
              <a href="#metrics" className="nav-link transition">Precision</a>
              <a href="#roles" className="nav-link transition">Ecosystem</a>
            </div>
          )}

          <div className="flex gap-4">
            {view === 'landing' ? (
              <button onClick={() => setIsAuthOpen(true)} className="bg-cyan-500 text-black px-6 py-2 rounded-full text-sm font-bold hover:bg-cyan-400 transition shadow-lg shadow-cyan-500/20">
                Sign In
              </button>
            ) : (
              <button onClick={logout} className="border border-red-500/30 text-red-400 px-6 py-2 rounded-full text-sm font-bold hover:bg-red-500/10 transition">
                Logout
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* VIEW: LANDING */}
      {view === 'landing' && (
        <main>
          <section className="relative pt-20 pb-20 px-6 hero-glow text-center">
              <div className="max-w-4xl mx-auto">
                  <h1 className="text-6xl md:text-7xl font-bold mb-8 leading-tight">
                      Attendance at the <br /> <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">Speed of Sight.</span>
                  </h1>
                  <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">No ID cards. No roll calls. One photo, total accuracy.</p>
                  <div className="flex flex-col sm:flex-row justify-center gap-4">
                      <button onClick={() => setIsAuthOpen(true)} className="bg-white text-black px-10 py-4 rounded-xl font-bold text-lg hover:bg-cyan-100 transition">Get Started</button>
                      <a href="#how-it-works" className="border border-white/20 px-10 py-4 rounded-xl font-bold text-lg hover:bg-white/5 transition inline-block text-white">Learn More</a>
                  </div>
              </div>
          </section>

          <section id="how-it-works" className="max-w-7xl mx-auto px-6 py-24 scroll-mt-24">
              <div className="text-center mb-16">
                  <h2 className="text-4xl font-bold mb-4">The 3-Step Process</h2>
                  <p className="text-gray-400">Transforming a classroom image into digital data.</p>
              </div>
              <div className="grid md:grid-cols-3 gap-12">
                  <div className="text-center p-8 glass-card rounded-3xl">
                      <div className="w-16 h-16 bg-cyan-500/20 text-cyan-400 rounded-full flex items-center justify-center mx-auto mb-6 text-2xl">1</div>
                      <h3 className="text-xl font-bold mb-4">Capture</h3>
                      <p className="text-gray-500">Professor uploads a high-res photo of the classroom through our secure portal.</p>
                  </div>
                  <div className="text-center p-8 glass-card rounded-3xl">
                      <div className="w-16 h-16 bg-blue-500/20 text-blue-400 rounded-full flex items-center justify-center mx-auto mb-6 text-2xl">2</div>
                      <h3 className="text-xl font-bold mb-4">Analyze</h3>
                      <p className="text-gray-500">Computer Vision detects faces and matches them against our biometric database.</p>
                  </div>
                  <div className="text-center p-8 glass-card rounded-3xl">
                      <div className="w-16 h-16 bg-purple-500/20 text-purple-400 rounded-full flex items-center justify-center mx-auto mb-6 text-2xl">3</div>
                      <h3 className="text-xl font-bold mb-4">Verify</h3>
                      <p className="text-gray-500">Attendance is instantly synced to the student portal for real-time tracking.</p>
                  </div>
              </div>
          </section>

          <section id="metrics" className="max-w-7xl mx-auto px-6 py-20 border-y border-white/5 scroll-mt-24">
            <div className="text-center mb-12"><h2 className="text-3xl font-bold text-white">Scientific Validation</h2></div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
              {[
                { label: 'Accuracy', val: '96.32%', color: 'text-cyan-400' },
                { label: 'Precision', val: '99.34%', color: 'text-cyan-400' },
                { label: 'Recall', val: '95.83%', color: 'text-cyan-400' },
                { label: 'F1-Score', val: '97.54%', color: 'text-cyan-400' },
                { label: 'FAR', val: '1.67%', color: 'text-red-400' },
                { label: 'FRR', val: '4.16%', color: 'text-red-400' },

              ].map((stat, i) => (
                <div key={i} className="p-8 rounded-3xl bg-white/5 border border-white/10 text-center">
                  <p className="text-gray-500 text-xs mb-2 uppercase tracking-widest">{stat.label}</p>
                  <h3 className={`text-4xl font-bold ${stat.color} stat-value`}>{stat.val}</h3>
                </div>
              ))}
            </div>
          </section>

          <section id="roles" className="max-w-7xl mx-auto px-6 py-32 scroll-mt-24">
              <div className="text-center mb-16"><h2 className="text-4xl font-bold">The Ecosystem</h2></div>
              <div className="grid md:grid-cols-3 gap-8">
                  <div className="p-10 glass-card rounded-3xl cursor-pointer hover:bg-white/5 transition" onClick={() => setIsAuthOpen(true)}>
                      <i className="fas fa-shield-alt text-3xl text-cyan-400 mb-6"></i>
                      <h3 className="text-2xl font-bold mb-4">University Admin</h3>
                      <ul className="text-gray-500 space-y-2 text-sm">
                          <li>• Enroll Subjects & Departments</li>
                          <li>• Bulk Upload Student Data</li>
                          <li>• Global Analytics</li>
                      </ul>
                  </div>
                  <div className="p-10 glass-card rounded-3xl cursor-pointer hover:bg-white/5 transition" onClick={() => setIsAuthOpen(true)}>
                      <i className="fas fa-chalkboard-teacher text-3xl text-blue-400 mb-6"></i>
                      <h3 className="text-2xl font-bold mb-4">Professor & Staff</h3>
                      <ul className="text-gray-500 space-y-2 text-sm">
                          <li>• CV-Powered Image Upload</li>
                          <li>• Class Session Management</li>
                          <li>• Accuracy Overrides</li>
                      </ul>
                  </div>
                  <div className="p-10 glass-card rounded-3xl cursor-pointer hover:bg-white/5 transition" onClick={() => setIsAuthOpen(true)}>
                      <i className="fas fa-user-graduate text-3xl text-purple-400 mb-6"></i>
                      <h3 className="text-2xl font-bold mb-4">Student</h3>
                      <ul className="text-gray-500 space-y-2 text-sm">
                          <li>• Personal Attendance View</li>
                          <li>• Subject-wise Insights</li>
                          <li>• Real-time Notifications</li>
                      </ul>
                  </div>
              </div>
          </section>
        </main>
      )}

      {/* VIEW: COMPANY ADMIN (HQ) */}
      {view === 'hq_admin' && (
        <main className="max-w-7xl mx-auto px-6 py-12 animate-in fade-in duration-700">
          {/* HEADER SECTION */}
          <div className="flex justify-between items-end mb-12">
            <div>
              {/* Breadcrumb / Back Button */}
              {adminSubView !== 'list' && (
                <button 
                  onClick={() => {
                    setAdminSubView('list');
                    setSelectedUni(null);
                  }}
                  className="text-cyan-400 text-sm font-black mb-4 flex items-center gap-2 hover:translate-x-[-4px] transition-transform uppercase tracking-widest"
                >
                  <i className="fas fa-arrow-left"></i> Back to HQ List
                </button>
              )}
              
              <h2 className="text-5xl font-black tracking-tighter text-white mb-2">
                HQ <span className="text-cyan-400">
                  {adminSubView === 'list' ? 'COMMAND' : adminSubView.toUpperCase()}
                </span>
              </h2>
              <p className="text-gray-500 font-medium">
                {selectedUni ? `Managing: ${selectedUni.name}` : 'Enterprise Ecosystem Management'}
              </p>
            </div>

            {/* Only show Onboard button on the main list */}
            {adminSubView === 'list' && (
              <button 
                onClick={() => setIsUniModalOpen(true)}
                className="bg-white text-black hover:bg-cyan-400 hover:scale-105 transition-all duration-300 font-black px-8 py-4 rounded-2xl shadow-xl shadow-white/5"
              >
                + ONBOARD UNIVERSITY
              </button>
            )}
          </div>

          {/* SUB-VIEW: VIEW LOGS */}
          {adminSubView === 'logs' && (
            <div className="glass-card p-8 rounded-[2rem] animate-in slide-in-from-bottom-4 border-white/10">
              <div className="flex justify-between items-center mb-8">
                <h3 className="text-2xl font-bold text-white">System Access Logs</h3>
                <span className="text-[10px] bg-white/5 text-gray-400 px-3 py-1 rounded-full border border-white/10 font-bold">LIVE FEED</span>
              </div>
              <div className="space-y-4">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="flex justify-between items-center p-5 bg-white/5 rounded-2xl border border-white/5 hover:border-cyan-500/30 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="w-2 h-2 rounded-full bg-cyan-500 shadow-[0_0_8px_#22d3ee]"></div>
                      <div>
                        <p className="text-white font-mono text-sm">AUTH_SYNC_SUCCESS_{1024 + i}</p>
                        <p className="text-gray-500 text-xs">Node: {selectedUni?.name.split(' ')[0]}_SERVER_01 • {new Date().toLocaleTimeString()}</p>
                      </div>
                    </div>
                    <span className="text-cyan-400 text-xs font-black tracking-widest bg-cyan-400/10 px-3 py-1 rounded">STABLE</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SUB-VIEW: EDIT BRANDING */}
          {adminSubView === 'branding' && (
            <div className="glass-card p-10 rounded-[2.5rem] animate-in slide-in-from-bottom-4 max-w-2xl border-white/10">
              <div className="space-y-8">
                <div>
                  <label className="text-xs font-black text-gray-500 uppercase tracking-widest block mb-4">Primary Brand Color</label>
                  <div className="flex gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-cyan-500 border-4 border-white ring-4 ring-cyan-500/20 cursor-pointer"></div>
                    <div className="w-14 h-14 rounded-2xl bg-purple-600 hover:scale-105 transition-transform cursor-pointer"></div>
                    <div className="w-14 h-14 rounded-2xl bg-emerald-500 hover:scale-105 transition-transform cursor-pointer"></div>
                    <div className="w-14 h-14 rounded-2xl bg-rose-500 hover:scale-105 transition-transform cursor-pointer"></div>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-black text-gray-500 uppercase tracking-widest block mb-3">Custom Portal Heading</label>
                  <input 
                    type="text" 
                    defaultValue={`${selectedUni?.name} Attendance Portal`}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-white outline-none focus:border-cyan-500 transition-colors"
                  />
                </div>
                <button 
                  onClick={() => {
                    alert('Branding updated successfully!');
                    setAdminSubView('list');
                  }}
                  className="w-full bg-white text-black font-black py-5 rounded-2xl hover:bg-cyan-400 transition-all active:scale-95"
                >
                  SAVE IDENTITY SETTINGS
                </button>
              </div>
            </div>
          )}

          {/* MAIN LIST VIEW */}
          {adminSubView === 'list' && (
            <>
              {/* UNI MODAL */}
              {isUniModalOpen && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-md p-6">
                  <div className="glass-card w-full max-w-md p-8 rounded-[2.5rem] border-white/20 animate-in zoom-in duration-300">
                    <h3 className="text-2xl font-bold mb-6">New Partner Onboarding</h3>
                    
                    {/* Updated Form */}
                    <form onSubmit={onboardUniversity} className="flex flex-col gap-4">
                      <input 
                        type="text" 
                        placeholder="University Name" 
                        value={onboardData.uni_name}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-cyan-500 outline-none"
                        onChange={(e) => setOnboardData({...onboardData, uni_name: e.target.value})}
                        required
                      />
                      <input 
                        type="text" 
                        placeholder="Admin Username" 
                        value={onboardData.admin_username}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-cyan-500 outline-none"
                        onChange={(e) => setOnboardData({...onboardData, admin_username: e.target.value})}
                        required
                      />
                      <input 
                        type="email" 
                        placeholder="Admin Email Address" 
                        value={onboardData.admin_email}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-cyan-500 outline-none"
                        onChange={(e) => setOnboardData({...onboardData, admin_email: e.target.value})}
                        required
                      />
                      <input 
                        type="password" 
                        placeholder="Initial Password" 
                        value={onboardData.admin_password}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-cyan-500 outline-none"
                        onChange={(e) => setOnboardData({...onboardData, admin_password: e.target.value})}
                        required
                      />

                      <div className="flex gap-3 mt-2">
                        <button 
                          type="submit"
                          disabled={isOnboarding} 
                          className={`flex-1 font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-2 ${
                          isOnboarding 
                            ? 'bg-cyan-500/50 text-black/50 cursor-not-allowed' 
                            : 'bg-cyan-500 text-black hover:bg-cyan-400'
                        }`}>
                          {isOnboarding ? (
                            <>
                              <i className="fas fa-spinner fa-spin"></i>
                              Sending...
                            </>
                          ) : (
                            'Confirm & Send Mail'
                          )}
                        </button>
                        <button 
                          type="button"
                          onClick={() => { 
                            setIsUniModalOpen(false); 
                            setOnboardData({ uni_name: "", admin_username: "", admin_email: "", admin_password: "" });
                          }} 
                          className="flex-1 bg-white/5 text-white py-4 rounded-xl hover:bg-white/10 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}

              {!adminStats ? (
                <div className="py-20 text-center text-gray-600 animate-pulse">Accessing Encrypted Records...</div>
              ) : adminStats.length === 0 ? (
                <div className="py-24 text-center glass-card rounded-[2rem] border border-white/10">
                  <i className="fas fa-university text-5xl text-gray-700 mb-6 block"></i>
                  <p className="text-gray-400 font-bold text-lg">No universities onboarded yet.</p>
                  <p className="text-gray-600 text-sm mt-2">Click <span className="text-cyan-400 font-bold">+ ONBOARD UNIVERSITY</span> to add the first partner.</p>
                </div>
              ) : (
                <div className="grid gap-6">
                  {Array.isArray(adminStats) && adminStats.map((uni) => (
                    <div key={uni.id} className="glass-card group hover:border-cyan-500/50 transition-all duration-500 p-8 rounded-[2rem] flex justify-between items-center">
                      <div className="flex items-center gap-6">
                        <div className="w-16 h-16 bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl flex items-center justify-center text-2xl font-bold text-cyan-400 border border-white/5 group-hover:border-cyan-500/30 transition-colors">
                          {uni.name.charAt(0)}
                        </div>
                        <div>
                          <h3 className="text-2xl font-bold text-white group-hover:text-cyan-400 transition-colors">{uni.name}</h3>
                          <p className="text-gray-500 text-sm uppercase tracking-widest font-bold">{uni.course_count || 0} Active Departments</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-8">
                        <div className="text-right hidden md:block">
                          <p className="text-xs text-gray-600 font-black uppercase tracking-widest">
                            System Status
                          </p>
                          {isSyncing ? (
                            <p className="text-cyan-400 font-bold flex items-center gap-2 justify-end transition-all duration-300">
                              <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                              </span> 
                              SYNCING...
                            </p>
                          ) : (
                            <p className="text-gray-500 font-bold flex items-center gap-2 justify-end transition-all duration-300">
                              <span className="h-2 w-2 rounded-full bg-gray-700"></span> 
                              STANDBY
                            </p>
                          )}
                        </div>
                        <div className="relative">
                          <button 
                            id={`gear-${uni.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveMenuId(activeMenuId === uni.id ? null : uni.id);
                            }}
                            className={`p-4 rounded-xl transition-all relative z-10 ${
                              activeMenuId === uni.id ? 'bg-cyan-500 text-black' : 'bg-white/5 text-gray-400'
                            }`}
                          >
                            <i className={`fas fa-cog ${activeMenuId === uni.id ? 'fa-spin' : ''}`}></i>
                          </button>

                          {activeMenuId === uni.id && createPortal(
                            <>
                              <div 
                                className="fixed inset-0 z-[9998] bg-black/60" 
                                onClick={() => setActiveMenuId(null)}
                              ></div>
                              
                              <div 
                                className="fixed z-[9999] dropdown-menu-container animate-in zoom-in"
                                style={dropdownStyle}
                              >
                                <div className="dropdown-header-area">
                                  <p className="text-[10px] font-black text-cyan-400 uppercase tracking-widest">
                                    Management
                                  </p>
                                </div>
                                
                                <div className="p-1">
                                  <button onClick={() => handleAdminAction(uni, 'branding')} className="dropdown-item group">
                                    <i className="fas fa-edit mr-3 w-4 text-gray-400 group-hover:text-cyan-400"></i>
                                    <span>Edit Branding</span>
                                  </button>

                                  <button onClick={() => handleAdminAction(uni, 'logs')} className="dropdown-item group">
                                    <i className="fas fa-history mr-3 w-4 text-gray-400 group-hover:text-cyan-400"></i>
                                    <span>View Logs</span>
                                  </button>

                                  <div className="h-px bg-white/10 my-1 mx-2"></div>

                                  <button 
                                    onClick={() => {
                                      removeUniversity(uni.id);
                                      setActiveMenuId(null);
                                    }}
                                    className="dropdown-item dropdown-item-danger"
                                  >
                                    <i className="fas fa-trash-alt mr-3 w-4"></i>
                                    <span>Remove Partner</span>
                                  </button>
                                </div>
                              </div>
                            </>,
                            document.body
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </main>
      )}

      {/* VIEW: UNI ADMIN */}
      {view === 'uni_admin' && <UniAdminDashboard showAlert={showAlert} showConfirm={showConfirm} />}

      {/* VIEW: PROFESSOR */}
      {view === 'professor' && <ProfessorDashboard showAlert={showAlert} showConfirm={showConfirm} username={userInput} />}

      {/* VIEW: STUDENT */}
      {view === 'student' && (
        <StudentDashboard showAlert={showAlert} username={userInput} />
      )}

      <footer className="py-12 border-t border-white/5 text-center mt-20">
        <p className="text-gray-600 text-sm">Attend-Vision AI © 2026. Empowering Smarter Campuses.</p>
      </footer>
      <CustomModal 
        {...modalConfig} 
        onCancel={() => setModalConfig(prev => ({...prev, isOpen: false}))} 
      />
    </div>
  );
}
