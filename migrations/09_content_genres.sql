INSERT INTO public.genres (slug, name) VALUES
    ('chan-dung', 'Chân dung'),
    ('kien-truc', 'Kiến trúc'),
    ('am-thuc', 'Ẩm thực'),
    ('dong-vat', 'Động vật'),
    ('the-thao', 'Thể thao'),
    ('cong-nghe', 'Công nghệ')
ON CONFLICT (slug) DO NOTHING;
