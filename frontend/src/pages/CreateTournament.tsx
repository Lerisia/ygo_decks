import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { isAuthenticated } from "../api/accountApi";
import { createTournament } from "../api/tournamentApi";

export default function CreateTournament() {
    const navigate = useNavigate();
    const [formData, setFormData] = useState({
        name: "",
        edition: "",
        cover_image: null as File | null,
        description: "",
        event_date: "",
    });
    const [coverPreview, setCoverPreview] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    if (!isAuthenticated()) {
        return (
            <div className="h-auto min-h-screen p-4 flex justify-center items-center">
                <p className="text-lg text-gray-600">로그인해야 대회를 생성할 수 있습니다.</p>
            </div>
        );
    }

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0] || null;

        if (file && file.size > 1048576) {
            setError("업로드할 수 있는 파일 크기는 최대 1MB입니다.");
            return;
        }

        setFormData((prev) => ({ ...prev, cover_image: file }));
        setError(null);

        if (file) {
            const reader = new FileReader();
            reader.onload = () => setCoverPreview(reader.result as string);
            reader.readAsDataURL(file);
        } else {
            setCoverPreview(null);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (!formData.name || !formData.event_date) {
            setError("이름과 일시는 필수 입력 사항입니다.");
            return;
        }

        try {
            await createTournament(formData);
            navigate("/tournaments");
        } catch (err) {
            console.error("Tournament creation failed:", err);
            setError("대회 생성 중 오류가 발생했습니다.");
        }
    };

    return (
        <div className="h-auto min-h-screen p-4">
            <h1 className="text-2xl font-bold mb-4 text-center">대회 생성</h1>
            <form onSubmit={handleSubmit} className="max-w-lg mx-auto bg-white p-6 rounded-lg shadow">
                {error && <p className="text-red-500 text-center mb-4">{error}</p>}

                <label className="block mb-2 font-semibold">대회 이름 *</label>
                <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    required
                    className="w-full px-3 py-2 border rounded-lg mb-4"
                />

                <label className="block mb-2 font-semibold">회차</label>
                <input
                    type="number"
                    name="edition"
                    value={formData.edition}
                    onChange={handleChange}
                    className="w-full px-3 py-2 border rounded-lg mb-4"
                />

                <label className="block mb-2 font-semibold">커버 이미지 (최대 1MB)</label>
                <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="w-full px-3 py-2 border rounded-lg mb-4"
                />
                {coverPreview && (
                    <img src={coverPreview} alt="Preview" className="w-full h-48 object-cover rounded mb-4" />
                )}

                <label className="block mb-2 font-semibold">설명</label>
                <textarea
                    name="description"
                    value={formData.description}
                    onChange={handleChange}
                    rows={4}
                    className="w-full px-3 py-2 border rounded-lg mb-4"
                />

                <label className="block mb-2 font-semibold">일시 *</label>
                <input
                    type="datetime-local"
                    name="event_date"
                    value={formData.event_date}
                    onChange={handleChange}
                    required
                    className="w-full px-3 py-2 border rounded-lg mb-4"
                />

                <div className="flex flex-col gap-2">
                    <button 
                        type="submit" 
                        className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg shadow hover:bg-blue-700 transition"
                    >
                        대회 생성
                    </button>

                    <button
                        type="button"
                        onClick={() => navigate("/tournaments")}
                        className="w-full px-4 py-2 bg-gray-500 text-white rounded-lg shadow hover:bg-gray-600 transition"
                    >
                        대회 목록으로 돌아가기
                    </button>
                </div>
            </form>
        </div>
    );
}
